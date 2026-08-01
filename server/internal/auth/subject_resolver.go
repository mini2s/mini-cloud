package auth

import (
	"context"
	"errors"
	"log/slog"
	"sort"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// SubjectUserStore is the subset of *db.Queries that NewSubjectResolver
// needs. Defined as an interface so the resolver can be unit-tested without
// a database.
type SubjectUserStore interface {
	GetUserBySubjectID(ctx context.Context, subjectID pgtype.Text) (db.MulticaUser, error)
	GetUserByEmail(ctx context.Context, email string) (db.MulticaUser, error)
	CreateUser(ctx context.Context, arg db.CreateUserParams) (db.MulticaUser, error)
	SetUserSubjectID(ctx context.Context, arg db.SetUserSubjectIDParams) error
	UpdateUserNameAndEmail(ctx context.Context, arg db.UpdateUserNameAndEmailParams) (db.MulticaUser, error)
	ListAuthIdentitiesBySubjects(ctx context.Context, subjects []string) ([]db.ListAuthIdentitiesBySubjectsRow, error)
	ListUsersBySubjectIDs(ctx context.Context, subjectIDs []string) ([]db.MulticaUser, error)
}

// SubjectResolveFunc maps a subject id (cloud-api "usr_..." subject, or the
// raw Casdoor "sub" when cloud translation is unavailable) to a Multica user
// UUID. It matches middleware.SubjectResolver's signature; main.go converts
// between the two named types (auth cannot import middleware — import cycle).
type SubjectResolveFunc func(ctx context.Context, subjectID, universalID, name, email string) (userID string, err error)

// NewSubjectResolver builds the Casdoor subject -> Multica user resolver.
//
// On first encounter of a subject the user is auto-provisioned with the real
// name/email from the JWT claims. Before provisioning, the resolver consults
// the cs-user identity bindings (user_auth_identities): the same person may
// already exist under a linked subject — a raw Casdoor sub captured while
// cloud translation was failing, or a different cloud subject per login
// method (phone vs OAuth). Provisioning without this check splits one human
// into several multica users, after which every workspace owned by the other
// identities 404s on member-gated routes.
//
// For existing users the email is kept in sync with Casdoor. The display
// name is intentionally NOT synced — see the comment at the sync site.
func NewSubjectResolver(store SubjectUserStore) SubjectResolveFunc {
	return func(ctx context.Context, subjectID, universalID, name, email string) (string, error) {
		// The embedded SSO JWT "sub" IS the cs-user subject_id, which is
		// the canonical resolver key. universal_id is passed through only
		// as a transient dept-sync lookup token and is not persisted.
		user, err := store.GetUserBySubjectID(ctx, pgtype.Text{String: subjectID, Valid: true})
		if err != nil {
			// No exact subject match — try the cs-user identity bindings
			// before creating a duplicate account.
			if linked := lookupLinkedUser(ctx, store, subjectID); linked != nil {
				user = *linked
				err = nil
			}
		}
		if err != nil {
			// Auto-provision: use real name/email from JWT, fall back to placeholders.
			if name == "" {
				name = "casdoor-" + subjectID
			}
			if email == "" {
				email = subjectID + "@casdoor.local"
			}
			user, err = store.CreateUser(ctx, db.CreateUserParams{
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
					existing, findErr := store.GetUserByEmail(ctx, email)
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
							if setErr := store.SetUserSubjectID(ctx, db.SetUserSubjectIDParams{
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
			if setErr := store.SetUserSubjectID(ctx, db.SetUserSubjectIDParams{
				ID:        user.ID,
				SubjectID: pgtype.Text{String: subjectID, Valid: true},
			}); setErr != nil {
				slog.Warn("failed to bind subject_id to auto-provisioned user",
					"user_id", util.UUIDToString(user.ID),
					"subject_id", subjectID,
					"error", setErr,
				)
			}
			slog.Info("casdoor: auto-provisioned user", "user_id", util.UUIDToString(user.ID), "subject_id", subjectID, "name", name)
			return util.UUIDToString(user.ID), nil
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
			existing, err := store.GetUserByEmail(ctx, email)
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
			if _, updErr := store.UpdateUserNameAndEmail(ctx, db.UpdateUserNameAndEmailParams{
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
	}
}

// lookupLinkedUser resolves subjectID through the cs-user identity bindings
// and returns the multica user keyed by any linked subject. Returns nil when
// no binding exists or the lookup fails — failures are logged and never fail
// the login itself. The returned user's own subject_id is left untouched:
// overwriting it would break the other login methods that resolve to it.
func lookupLinkedUser(ctx context.Context, store SubjectUserStore, subjectID string) *db.MulticaUser {
	subjects, err := collectLinkedSubjects(ctx, store, subjectID)
	if err != nil {
		if isUndefinedTable(err) {
			// Standalone deployment without a co-located cs-user — the
			// table legitimately does not exist here.
			slog.Debug("casdoor: user_auth_identities not present, skipping identity-link resolution", "error", err)
		} else {
			slog.Warn("casdoor: identity-link lookup failed, continuing without it", "subject_id", subjectID, "error", err)
		}
		return nil
	}
	if len(subjects) == 0 {
		return nil
	}
	users, err := store.ListUsersBySubjectIDs(ctx, subjects)
	if err != nil {
		slog.Warn("casdoor: identity-link user lookup failed, continuing without it", "subject_id", subjectID, "error", err)
		return nil
	}
	if len(users) == 0 {
		return nil
	}
	sort.Slice(users, func(i, j int) bool {
		return users[i].CreatedAt.Time.Before(users[j].CreatedAt.Time)
	})
	if len(users) > 1 {
		ids := make([]string, len(users))
		for i, u := range users {
			ids[i] = util.UUIDToString(u.ID)
		}
		slog.Warn("casdoor: multiple users share linked subjects, resolving to oldest",
			"subject_id", subjectID,
			"user_ids", ids,
			"resolved_user_id", ids[0],
		)
	}
	return &users[0]
}

// collectLinkedSubjects expands subjectID into the full set of subjects bound
// to the same cs-user account (cloud subjects and raw Casdoor subs, in both
// directions). Bindings form a star around the cloud subject, so reaching a
// sibling leaf takes two hops; the loop is bounded defensively. Returns nil
// when the subject has no bindings.
func collectLinkedSubjects(ctx context.Context, store SubjectUserStore, subjectID string) ([]string, error) {
	const (
		maxIterations = 4
		maxSubjects   = 32
	)
	seen := map[string]bool{subjectID: true}
	frontier := []string{subjectID}
	for i := 0; i < maxIterations && len(frontier) > 0 && len(seen) < maxSubjects; i++ {
		rows, err := store.ListAuthIdentitiesBySubjects(ctx, frontier)
		if err != nil {
			return nil, err
		}
		frontier = frontier[:0]
		for _, row := range rows {
			for _, s := range []string{row.UserSubjectID, row.ExternalSubject.String} {
				if s != "" && !seen[s] {
					seen[s] = true
					frontier = append(frontier, s)
				}
			}
		}
	}
	if len(seen) <= 1 {
		return nil, nil
	}
	out := make([]string, 0, len(seen))
	for s := range seen {
		out = append(out, s)
	}
	return out, nil
}

// isUndefinedTable reports whether err is PostgreSQL SQLSTATE 42P01
// (undefined_table) — the signal that user_auth_identities is absent in this
// deployment.
func isUndefinedTable(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}
