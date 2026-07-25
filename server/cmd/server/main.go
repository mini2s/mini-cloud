package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/joho/godotenv"
	"github.com/multica-ai/multica/server/internal/analytics"
	"github.com/multica-ai/multica/server/internal/daemonws"
	"github.com/multica-ai/multica/server/internal/deptsync"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/logger"
	obsmetrics "github.com/multica-ai/multica/server/internal/metrics"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/realtime"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/teamnamespace"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/redis/go-redis/v9"
)

var (
	version = "dev"
	commit  = "unknown"
)

const (
	workflowDispatchWorkerConcurrency = 2
	workflowDispatchPollInterval      = time.Second
	workflowDispatchLeaseDuration     = 30 * time.Second
)

func newNamedRedisClient(base *redis.Options, suffix string) *redis.Client {
	opts := *base
	opts.ClientName = redisClientName(opts.ClientName, suffix)
	return redis.NewClient(&opts)
}

func redisClientName(existing, suffix string) string {
	if suffix == "" {
		return existing
	}
	if existing != "" {
		return existing + ":" + suffix
	}
	return "multica-api:" + suffix
}

func closeRedisClient(label string, client *redis.Client) {
	if client == nil {
		return
	}
	if err := client.Close(); err != nil {
		slog.Warn("redis client close failed", "client", label, "error", err)
	}
}

func shardedRelayConfigFromEnv() realtime.ShardedStreamRelayConfig {
	cfg := realtime.DefaultShardedStreamRelayConfig()
	cfg.Shards = envPositiveInt("REALTIME_RELAY_SHARDS", cfg.Shards)
	cfg.StreamMaxLen = envPositiveInt64("REALTIME_RELAY_STREAM_MAXLEN", cfg.StreamMaxLen)
	cfg.ReadCount = envPositiveInt64("REALTIME_RELAY_XREAD_COUNT", cfg.ReadCount)
	cfg.ReadBlock = envDuration("REALTIME_RELAY_XREAD_BLOCK", cfg.ReadBlock)
	return cfg
}

func realtimeRelayModeFromEnv() string {
	const defaultMode = "sharded"
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("REALTIME_RELAY_MODE")))
	if raw == "" {
		return defaultMode
	}
	switch raw {
	case "sharded", "dual", "legacy":
		return raw
	default:
		slog.Warn("invalid env var, using default", "name", "REALTIME_RELAY_MODE", "value", raw, "default", defaultMode)
		return defaultMode
	}
}

func envPositiveInt(name string, def int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		slog.Warn("invalid env var, using default", "name", name, "value", raw, "default", def, "error", err)
		return def
	}
	return v
}

func envPositiveInt64(name string, def int64) int64 {
	raw := os.Getenv(name)
	if raw == "" {
		return def
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v <= 0 {
		slog.Warn("invalid env var, using default", "name", name, "value", raw, "default", def, "error", err)
		return def
	}
	return v
}

func envDuration(name string, def time.Duration) time.Duration {
	raw := os.Getenv(name)
	if raw == "" {
		return def
	}
	v, err := time.ParseDuration(raw)
	if err != nil || v <= 0 {
		slog.Warn("invalid env var, using default", "name", name, "value", raw, "default", def.String(), "error", err)
		return def
	}
	return v
}

func main() {
	// Load .env from project root or current directory.
	_ = godotenv.Load("../.env")
	_ = godotenv.Load()
	logger.Init()

	// Warn about missing configuration
	if os.Getenv("JWT_SECRET") == "" {
		slog.Warn("JWT_SECRET is not set — using insecure default. Set JWT_SECRET for production use.")
	}
	if os.Getenv("RESEND_API_KEY") == "" && strings.TrimSpace(os.Getenv("SMTP_HOST")) == "" {
		slog.Warn("no email backend configured (RESEND_API_KEY and SMTP_HOST both empty) — verification codes will be printed to the log instead of emailed.")
	}
	if os.Getenv("MULTICA_DEV_VERIFICATION_CODE") != "" {
		if strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production") {
			slog.Warn("MULTICA_DEV_VERIFICATION_CODE is set but ignored because APP_ENV=production.")
		} else {
			slog.Warn("MULTICA_DEV_VERIFICATION_CODE is enabled. Use it only for local development or private test instances.")
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://costrict:costrict_password@localhost:5432/costrict"
	}

	// Connect to database
	ctx := context.Background()
	pool, err := newDBPool(ctx, dbURL)
	if err != nil {
		slog.Error("unable to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("unable to ping database", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to database")
	logPoolConfig(pool)

	bus := events.New()
	hub := realtime.NewHub()
	go hub.Run()
	daemonHub := daemonws.NewHub()
	var daemonWakeup service.TaskWakeupNotifier = daemonHub

	// MUL-1138: when REDIS_URL is set, route fanout through a Redis relay so
	// multiple API nodes can deliver each other's events. Without it the hub
	// is the sole broadcaster and the server stays single-node (legacy).
	// Runtime local-skill stores and realtime relay traffic use separate Redis
	// clients so blocking stream consumers cannot starve request-path Redis
	// operations.
	relayCtx, relayCancel := context.WithCancel(context.Background())
	var broadcaster realtime.Broadcaster = hub
	var storeRedis *redis.Client
	var relayWriteRedis *redis.Client
	var relayReadRedis *redis.Client
	var shardedReadRedis *redis.Client
	var legacyReadRedis *redis.Client
	var relay realtime.ManagedRelay
	defer func() {
		if relay != nil {
			relay.Stop()
		}
		relayCancel()
		if relay != nil {
			relay.Wait()
		}
		closeRedisClient("realtime-read-legacy", legacyReadRedis)
		closeRedisClient("realtime-read-sharded", shardedReadRedis)
		closeRedisClient("realtime-read", relayReadRedis)
		closeRedisClient("realtime-write", relayWriteRedis)
		closeRedisClient("store", storeRedis)
	}()
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		opts, err := redis.ParseURL(redisURL)
		if err != nil {
			slog.Error("invalid REDIS_URL — falling back to in-memory hub", "error", err)
		} else {
			storeRedis = newNamedRedisClient(opts, "store")
			relayWriteRedis = newNamedRedisClient(opts, "realtime-write")

			relayMode := realtimeRelayModeFromEnv()
			relayConfig := shardedRelayConfigFromEnv()
			switch relayMode {
			case "legacy":
				relayReadRedis = newNamedRedisClient(opts, "realtime-read")
				relay = realtime.NewRedisRelayWithClients(hub, relayWriteRedis, relayReadRedis)
				slog.Info("daemon websocket wakeup: Redis fanout disabled in legacy realtime relay mode")
			case "dual":
				shardedReadRedis = newNamedRedisClient(opts, "realtime-read-sharded")
				legacyReadRedis = newNamedRedisClient(opts, "realtime-read-legacy")
				sharded := realtime.NewShardedStreamRelay(hub, relayWriteRedis, shardedReadRedis, relayConfig)
				sharded.SetDaemonRuntimeDeliverer(daemonHub)
				legacy := realtime.NewRedisRelayWithClients(hub, relayWriteRedis, legacyReadRedis)
				relay = realtime.NewMirroredRelay(sharded, legacy)
				daemonWakeup = daemonws.NewRelayNotifier(daemonHub, sharded)
			default:
				relayReadRedis = newNamedRedisClient(opts, "realtime-read")
				sharded := realtime.NewShardedStreamRelay(hub, relayWriteRedis, relayReadRedis, relayConfig)
				sharded.SetDaemonRuntimeDeliverer(daemonHub)
				relay = sharded
				daemonWakeup = daemonws.NewRelayNotifier(daemonHub, sharded)
			}
			relay.Start(relayCtx)
			broadcaster = realtime.NewDualWriteBroadcaster(hub, relay)
			slog.Info(
				"realtime: Redis relay enabled",
				"node_id", relay.NodeID(),
				"mode", relayMode,
				"shards", relayConfig.Shards,
				"stream_max_len", relayConfig.StreamMaxLen,
				"xread_count", relayConfig.ReadCount,
				"xread_block", relayConfig.ReadBlock.String(),
				"store_pool_size", opts.PoolSize,
				"realtime_write_pool_size", opts.PoolSize,
				"realtime_read_pool_size", opts.PoolSize,
			)
		}
	} else {
		slog.Info("realtime: REDIS_URL not set — using in-memory hub (single-node mode)")
	}
	registerListeners(bus, broadcaster)

	analyticsClient := analytics.NewFromEnv()
	defer analyticsClient.Close()

	queries := db.New(pool)
	hub.SetAuthorizer(newScopeAuthorizer(queries))
	// Order matters: subscriber listeners must register BEFORE notification listeners.
	// The notification listener queries the subscriber table to determine recipients,
	// so subscribers must be written first within the same synchronous event dispatch.
	registerSubscriberListeners(bus, queries)
	registerActivityListeners(bus, queries)
	registerNotificationListeners(bus, queries)

	metricsConfig := obsmetrics.ConfigFromEnv()
	var metricsServer *http.Server
	var httpMetrics *obsmetrics.HTTPMetrics
	if metricsConfig.Enabled() {
		metricsRegistry := obsmetrics.NewRegistry(obsmetrics.RegistryOptions{
			Pool:     pool,
			Realtime: realtime.M,
			DaemonWS: daemonws.M,
			Version:  version,
			Commit:   commit,
		})
		httpMetrics = metricsRegistry.HTTP
		metricsServer = obsmetrics.NewServer(metricsConfig.Addr, metricsRegistry.Gatherer)
		if !obsmetrics.IsLoopbackAddr(metricsConfig.Addr) {
			slog.Warn(
				"metrics listener is not loopback-only; restrict access with private networking, allowlists, or proxy auth",
				"addr", metricsConfig.Addr,
			)
		}
	}

	// Casdoor SSO: when CASDOOR_ENDPOINT is set, Casdoor JWTs are accepted on
	// protected routes. The RS256 signature is verified by the gateway in
	// front of Multica, so the backend only gates the CasdoorAuth middleware
	// and the SSO login/callback routes. Both modes support PAT tokens (the
	// CasdoorAuth middleware passes "mul_" prefixed Bearer tokens through to
	// the downstream Auth middleware).
	casdoorEndpoint := os.Getenv("CASDOOR_ENDPOINT")
	casdoorEnabled := casdoorEndpoint != ""
	if casdoorEnabled {
		slog.Info("Casdoor SSO enabled", "endpoint", casdoorEndpoint)
	} else {
		slog.Warn("Casdoor SSO not configured — using legacy HMAC JWT auth")
	}

	// deptSyncClient is shared by the handler (member management) and the
	// SubjectResolver (login-time dept linking), so both auth paths use one
	// configured client.
	deptSyncClient := deptsync.NewClient(deptsync.Config{
		BaseURL:  strings.TrimRight(strings.TrimSpace(os.Getenv("DEPT_SYNC_BASE_URL")), "/"),
		QueryKey: os.Getenv("DEPT_SYNC_QUERY_KEY"),
		Timeout:  envDuration("DEPT_SYNC_TIMEOUT", 10*time.Second),
		CacheTTL: envDuration("DEPT_SYNC_CACHE_TTL", time.Minute),
	})
	giteaClient := gitea.NewClient(gitea.Config{
		BaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("GITEA_BASE_URL")), "/"),
		Token:   os.Getenv("GITEA_ADMIN_TOKEN"),
		Timeout: envDuration("GITEA_TIMEOUT", 10*time.Second),
	})
	teamNamespaceClient := teamnamespace.NewClient(teamnamespace.Config{
		BaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("TEAM_NAMESPACE_API_BASE_URL")), "/"),
		Token:   os.Getenv("TEAM_NAMESPACE_INTERNAL_SERVICE_TOKEN"),
		Tenant:  os.Getenv("TEAM_NAMESPACE_TENANT_ID"),
		Timeout: envDuration("TEAM_NAMESPACE_API_TIMEOUT", 10*time.Second),
	})
	// The SubjectResolver fires on every authenticated request; bound the
	// dept-link work (dept-sync call + DB writes) to once per window per user.
	deptLinkThrottle := &linkThrottle{last: make(map[string]time.Time), ttl: envDuration("DEPT_LINK_INTERVAL", 5*time.Minute)}

	// subjectResolver maps a Casdoor subject_id (the "sub" claim) to a
	// Multica user UUID. On first encounter the user is auto-provisioned
	// with the real name/email from the JWT claims. For existing users,
	// the name and email are kept in sync with Casdoor.
	subjectResolver := middleware.SubjectResolver(func(ctx context.Context, subjectID, universalID, name, email string) (userID string, err error) {
		// After resolving the user, asynchronously bind + refresh their dept
		// identity: activate any pending dept membership (→ the inviting
		// workspace links to this account) and overwrite their name / org
		// snapshot from dept-sync (→ repairs placeholder names like a Casdoor
		// login UUID). This is the path costrict's embedded iframe actually
		// uses (zgsmAdminToken cookie), so the linking must happen here, not
		// only in the standalone Casdoor OAuth callback. Throttled per user so
		// it doesn't run on every request; detached context so it survives the
		// response being written.
		defer func() {
			if err != nil || userID == "" || strings.TrimSpace(universalID) == "" {
				return
			}
			parsed, perr := util.ParseUUID(userID)
			if perr != nil {
				slog.Warn("dept link: could not parse resolved user id", "user_id", userID, "error", perr)
				return
			}
			if !deptLinkThrottle.allow(universalID) {
				return
			}
			uid, uni := parsed, universalID
			go func() {
				bgCtx, cancel := context.WithTimeout(context.Background(), envDuration("DEPT_LINK_TIMEOUT", 15*time.Second))
				defer cancel()
				handler.LinkDeptIdentity(bgCtx, queries, deptSyncClient, bus, uid, uni)
			}()
		}()
		// Prefer universal_id (stable across identity systems): a cs-user token's
		// sub is cs-user's own user id, not the local Casdoor sub this account was
		// originally provisioned under — but universal_id identifies the same
		// person. Fall back to subject_id when universal_id is absent/unbound.
		var user db.MulticaUser
		if universalID != "" {
			user, err = queries.GetUserByCasdoorUniversalID(ctx, pgtype.Text{String: universalID, Valid: true})
		}
		if universalID == "" || err != nil {
			user, err = queries.GetUserBySubjectID(ctx, pgtype.Text{String: subjectID, Valid: true})
		}
		if err != nil {
			// Auto-provision: use real name/email from JWT, fall back to placeholders.
			if name == "" {
				name = "casdoor-" + subjectID
			}
			if email == "" {
				email = subjectID + "@casdoor.local"
			}
			user, err = queries.CreateUser(ctx, db.CreateUserParams{
				Name:      name,
				Email:     email,
				AvatarUrl: pgtype.Text{},
			})
			if err != nil {
				// The email already belongs to an existing account that isn't
				// linked to this subject_id yet — e.g. the person was
				// provisioned earlier under a different Casdoor subject (re-created
				// in Casdoor, org migration) or a pre-Casdoor local account holds
				// this email. Adopt that account by binding this subject_id to it,
				// unless it already carries a *different* subject_id (a genuine
				// two-identity-one-email collision we must not silently hijack).
				if util.IsUniqueViolation(err) {
					existing, findErr := queries.GetUserByEmail(ctx, email)
					if findErr == nil {
						if existing.SubjectID.Valid && existing.SubjectID.String != subjectID {
							slog.Warn("casdoor: email owned by a different subject_id, refusing to adopt",
								"subject_id", subjectID,
								"existing_subject_id", existing.SubjectID.String,
								"existing_user_id", util.UUIDToString(existing.ID),
								"email", email,
							)
							return "", err
						}
						if !existing.SubjectID.Valid {
							if setErr := queries.SetUserSubjectID(ctx, db.SetUserSubjectIDParams{
								ID:        existing.ID,
								SubjectID: pgtype.Text{String: subjectID, Valid: true},
							}); setErr != nil {
								slog.Warn("casdoor: failed to adopt existing user by email",
									"user_id", util.UUIDToString(existing.ID),
									"subject_id", subjectID,
									"error", setErr,
								)
								return "", setErr
							}
						}
						if universalID != "" {
							if setErr := queries.SetUserCasdoorUniversalID(ctx, db.SetUserCasdoorUniversalIDParams{
								ID:                 existing.ID,
								CasdoorUniversalID: pgtype.Text{String: universalID, Valid: true},
							}); setErr != nil {
								slog.Warn("casdoor: failed to bind universal_id to adopted user",
									"user_id", util.UUIDToString(existing.ID),
									"universal_id", universalID,
									"error", setErr,
								)
							}
						}
						slog.Info("casdoor: adopted existing user by email",
							"user_id", util.UUIDToString(existing.ID),
							"subject_id", subjectID,
							"email", email,
						)
						return util.UUIDToString(existing.ID), nil
					}
				}
				return "", err
			}
			if setErr := queries.SetUserSubjectID(ctx, db.SetUserSubjectIDParams{
				ID:        user.ID,
				SubjectID: pgtype.Text{String: subjectID, Valid: true},
			}); setErr != nil {
				slog.Warn("failed to bind subject_id to auto-provisioned user",
					"user_id", util.UUIDToString(user.ID),
					"subject_id", subjectID,
					"error", setErr,
				)
			}
			if universalID != "" {
				if setErr := queries.SetUserCasdoorUniversalID(ctx, db.SetUserCasdoorUniversalIDParams{
					ID:                 user.ID,
					CasdoorUniversalID: pgtype.Text{String: universalID, Valid: true},
				}); setErr != nil {
					slog.Warn("failed to bind casdoor universal_id to auto-provisioned user",
						"user_id", util.UUIDToString(user.ID),
						"universal_id", universalID,
						"error", setErr,
					)
				}
			}
			slog.Info("casdoor: auto-provisioned user", "user_id", util.UUIDToString(user.ID), "subject_id", subjectID, "name", name)
			return util.UUIDToString(user.ID), nil
		}
		if universalID != "" && (!user.CasdoorUniversalID.Valid || user.CasdoorUniversalID.String != universalID) {
			if setErr := queries.SetUserCasdoorUniversalID(ctx, db.SetUserCasdoorUniversalIDParams{
				ID:                 user.ID,
				CasdoorUniversalID: pgtype.Text{String: universalID, Valid: true},
			}); setErr != nil {
				slog.Warn("failed to sync casdoor universal_id",
					"user_id", util.UUIDToString(user.ID),
					"subject_id", subjectID,
					"universal_id", universalID,
					"error", setErr,
				)
			}
		}

		// Existing user: sync email if it changed in Casdoor. The display
		// name is intentionally NOT synced from Casdoor here — for
		// phone-registered accounts the Casdoor "name" is a placeholder UUID,
		// and dept-sync is the org source of truth for names. LinkDeptIdentity
		// (run on resolve, throttled) refreshes the name from dept-sync;
		// syncing the Casdoor name here would overwrite that back to the UUID
		// on every request.
		syncEmail := email != "" && user.Email != email

		// Guard against unique-key violations: if another user already owns
		// this email (e.g. a pre-existing local account), skip the email sync.
		if syncEmail {
			existing, err := queries.GetUserByEmail(ctx, email)
			if err == nil && existing.ID != user.ID {
				slog.Warn("casdoor email already owned by another user, skipping email sync",
					"user_id", util.UUIDToString(user.ID),
					"existing_user_id", util.UUIDToString(existing.ID),
					"email", email,
				)
				syncEmail = false
			}
		}

		if syncEmail {
			if _, updErr := queries.UpdateUserNameAndEmail(ctx, db.UpdateUserNameAndEmailParams{
				ID:    user.ID,
				Name:  user.Name, // keep current; dept-sync owns the name
				Email: email,
			}); updErr != nil {
				slog.Warn("failed to sync user email from Casdoor",
					"user_id", util.UUIDToString(user.ID),
					"subject_id", subjectID,
					"error", updErr,
				)
			} else {
				slog.Info("casdoor: synced user email", "user_id", util.UUIDToString(user.ID), "subject_id", subjectID)
			}
		}
		return util.UUIDToString(user.ID), nil
	})

	// Construct the BatchedHeartbeatScheduler before the router so it can
	// be injected into the Handler. The Run goroutine starts below
	// alongside the sweeper, and Stop is called explicitly during graceful
	// shutdown so any pending bumps are flushed before we exit.
	heartbeatScheduler := handler.NewBatchedHeartbeatScheduler(queries, handler.DefaultHeartbeatBatchInterval)

	// Skill proxy: when COSTRICT_API_INTERNAL is set, create a proxy client
	// that forwards skill requests to the costrict-web internal API with
	// rate limiting, caching, and audit logging.
	var skillProxy *service.SkillProxy
	if costrictAPI := strings.TrimSpace(os.Getenv("COSTRICT_API_INTERNAL")); costrictAPI != "" {
		costrictSecret := os.Getenv("COSTRICT_INTERNAL_SECRET")
		skillProxy = service.NewSkillProxy(costrictAPI, costrictSecret, 5*time.Minute, queries)
		slog.Info("skill proxy enabled", "base_url", costrictAPI)
	}

	roleResolutionRuntime := workflowRoleResolutionRuntimeFromEnv(deptSyncClient)

	r := NewRouterWithOptions(pool, hub, bus, analyticsClient, storeRedis, RouterOptions{
		HTTPMetrics:            httpMetrics,
		DaemonHub:              daemonHub,
		DaemonWakeup:           daemonWakeup,
		HeartbeatScheduler:     heartbeatScheduler,
		SubjectResolver:        subjectResolver,
		CasdoorEnabled:         casdoorEnabled,
		SkillProxy:             skillProxy,
		DeptSync:               deptSyncClient,
		Gitea:                  giteaClient,
		TeamNamespace:          teamNamespaceClient,
		WorkflowRoleResolution: roleResolutionRuntime,
	})

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	// Start background workers.
	sweepCtx, sweepCancel := context.WithCancel(context.Background())
	autopilotCtx, autopilotCancel := context.WithCancel(context.Background())
	taskSvc := service.NewTaskService(queries, pool, hub, bus, daemonWakeup)
	taskSvc.Analytics = analyticsClient
	roleWorkflowSvc := service.NewWorkflowService(queries, pool, bus, taskSvc)
	roleWorkflowSvc.Gitea = giteaClient
	roleWorkflowSvc.TeamNamespace = teamNamespaceClient
	hostname, _ := os.Hostname()
	for i := 0; i < roleResolutionRuntime.WorkerConcurrency; i++ {
		worker := &service.WorkflowRoleResolutionWorker{
			Queries: queries, TxStarter: pool,
			Resolver: roleResolutionRuntime.Resolver, Organization: roleResolutionRuntime.Organization,
			WorkerID:     hostname + "-workflow-role-" + strconv.Itoa(i+1),
			PollInterval: roleResolutionRuntime.PollInterval, LeaseDuration: roleResolutionRuntime.LeaseDuration,
			MaxCandidates: roleResolutionRuntime.MaxCandidates, MaxSlots: roleResolutionRuntime.MaxSlots,
			MaxInputChars: roleResolutionRuntime.MaxInputChars,
			OnStateChanged: func(_ context.Context, workspaceID, runID pgtype.UUID) {
				payload := map[string]any{"run_id": util.UUIDToString(runID)}
				for _, eventType := range []string{"workflow_role_resolution_updated", "workflow_run_updated"} {
					bus.Publish(events.Event{
						Type: eventType, WorkspaceID: util.UUIDToString(workspaceID),
						ActorType: "system", Payload: payload,
					})
				}
			},
		}
		go worker.Run(sweepCtx)
	}
	for i := 0; i < workflowDispatchWorkerConcurrency; i++ {
		worker := &service.WorkflowDispatchWorker{
			Queries: queries, TxStarter: pool, Workflow: roleWorkflowSvc,
			WorkerID:      hostname + "-workflow-dispatch-" + strconv.Itoa(i+1),
			PollInterval:  workflowDispatchPollInterval,
			LeaseDuration: workflowDispatchLeaseDuration,
		}
		go worker.Run(sweepCtx)
	}
	notificationWorker := &service.WorkflowRoleNotificationWorker{
		Queries: queries, Email: service.NewEmailService(),
		WorkerID: hostname + "-workflow-role-email",
	}
	go notificationWorker.Run(sweepCtx)
	autopilotSvc := service.NewAutopilotService(queries, pool, bus, taskSvc)
	registerAutopilotListeners(bus, autopilotSvc)

	// Construct a LivenessStore that mirrors the one wired into the HTTP
	// handler. Both the heartbeat write path (handler) and the sweeper read
	// path (here) must agree on the same Redis-or-Noop choice; if they
	// disagree, online runtimes get falsely marked offline.
	var liveness handler.LivenessStore = handler.NewNoopLivenessStore()
	if storeRedis != nil {
		liveness = handler.NewRedisLivenessStore(storeRedis)
	}

	// Start background sweeper to mark stale runtimes as offline.
	go runRuntimeSweeper(sweepCtx, queries, liveness, taskSvc, bus)
	go heartbeatScheduler.Run(sweepCtx)
	go runAutopilotScheduler(autopilotCtx, queries, autopilotSvc)
	go runAutopilotFailureMonitor(autopilotCtx, queries, bus, envFailureMonitorConfig())
	go runDBStatsLogger(sweepCtx, pool)

	if metricsServer != nil {
		go func() {
			slog.Info("metrics server starting", "addr", metricsConfig.Addr)
			if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Error("metrics server disabled after startup error", "error", err)
			}
		}()
	}

	go func() {
		slog.Info("server starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down server")
	autopilotCancel()

	// Order matters: drain in-flight HTTP first so any heartbeat handlers
	// finish calling Schedule() before we stop the scheduler. Otherwise a
	// late heartbeat could enqueue a pending ID after Run has already
	// drained and exited, and Stop() would not flush it.
	apiShutdownCtx, apiShutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := srv.Shutdown(apiShutdownCtx); err != nil {
		apiShutdownCancel()
		slog.Error("server forced to shutdown", "error", err)
		os.Exit(1)
	}
	apiShutdownCancel()

	// HTTP is fully drained — safe to stop the sweeper and flush the
	// final batch of queued heartbeat bumps.
	sweepCancel()
	heartbeatScheduler.Stop()

	if metricsServer != nil {
		metricsShutdownCtx, metricsShutdownCancel := context.WithTimeout(context.Background(), 3*time.Second)
		if err := metricsServer.Shutdown(metricsShutdownCtx); err != nil {
			slog.Error("metrics server forced to shutdown", "error", err)
		}
		metricsShutdownCancel()
	}
	slog.Info("server stopped")
}

// linkThrottle is a per-key TTL gate. allow reports whether enough time has
// passed since the last allowed call for the key, recording the attempt when
// it does. Used by the SubjectResolver to bound how often per user the
// (dept-sync + DB) dept-link work runs.
type linkThrottle struct {
	mu   sync.Mutex
	last map[string]time.Time
	ttl  time.Duration
}

func (t *linkThrottle) allow(key string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if l, ok := t.last[key]; ok && time.Since(l) < t.ttl {
		return false
	}
	t.last[key] = time.Now()
	return true
}
