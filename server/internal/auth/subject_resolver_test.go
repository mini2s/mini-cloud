package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// fakeSubjectUserStore implements SubjectUserStore in memory for resolver tests.
type fakeSubjectUserStore struct {
	bySubject   map[string]db.MulticaUser
	byEmail     map[string]db.MulticaUser
	identities  []db.ListAuthIdentitiesBySubjectsRow
	identityErr error

	identityCalls int
	createCalls   int
	setSubjCalls  int
	createErr     error
}

func (f *fakeSubjectUserStore) GetUserBySubjectID(_ context.Context, subjectID pgtype.Text) (db.MulticaUser, error) {
	if subjectID.Valid {
		if u, ok := f.bySubject[subjectID.String]; ok {
			return u, nil
		}
	}
	return db.MulticaUser{}, pgx.ErrNoRows
}

func (f *fakeSubjectUserStore) GetUserByEmail(_ context.Context, email string) (db.MulticaUser, error) {
	if u, ok := f.byEmail[email]; ok {
		return u, nil
	}
	return db.MulticaUser{}, pgx.ErrNoRows
}

func (f *fakeSubjectUserStore) CreateUser(_ context.Context, arg db.CreateUserParams) (db.MulticaUser, error) {
	f.createCalls++
	if f.createErr != nil {
		return db.MulticaUser{}, f.createErr
	}
	u := db.MulticaUser{
		ID:        util.MustParseUUID("00000000-0000-0000-0000-0000000000ff"),
		Name:      arg.Name,
		Email:     arg.Email,
		CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}
	return u, nil
}

func (f *fakeSubjectUserStore) SetUserSubjectID(_ context.Context, _ db.SetUserSubjectIDParams) error {
	f.setSubjCalls++
	return nil
}

func (f *fakeSubjectUserStore) UpdateUserNameAndEmail(_ context.Context, arg db.UpdateUserNameAndEmailParams) (db.MulticaUser, error) {
	return db.MulticaUser{ID: arg.ID, Name: arg.Name, Email: arg.Email}, nil
}

func (f *fakeSubjectUserStore) ListAuthIdentitiesBySubjects(_ context.Context, subjects []string) ([]db.ListAuthIdentitiesBySubjectsRow, error) {
	f.identityCalls++
	if f.identityErr != nil {
		return nil, f.identityErr
	}
	want := make(map[string]bool, len(subjects))
	for _, s := range subjects {
		want[s] = true
	}
	var out []db.ListAuthIdentitiesBySubjectsRow
	for _, row := range f.identities {
		if want[row.UserSubjectID] || want[row.ExternalSubject.String] {
			out = append(out, row)
		}
	}
	return out, nil
}

func (f *fakeSubjectUserStore) ListUsersBySubjectIDs(_ context.Context, subjects []string) ([]db.MulticaUser, error) {
	want := make(map[string]bool, len(subjects))
	for _, s := range subjects {
		want[s] = true
	}
	var out []db.MulticaUser
	for subj, u := range f.bySubject {
		if want[subj] {
			out = append(out, u)
		}
	}
	return out, nil
}

func makeUser(id, subjectID string, createdAt time.Time) db.MulticaUser {
	return db.MulticaUser{
		ID:        util.MustParseUUID(id),
		Name:      "tester",
		Email:     subjectID + "@casdoor.local",
		SubjectID: pgtype.Text{String: subjectID, Valid: subjectID != ""},
		CreatedAt: pgtype.Timestamptz{Time: createdAt, Valid: true},
	}
}

func makeIdentity(userSubjectID, externalSubject string) db.ListAuthIdentitiesBySubjectsRow {
	return db.ListAuthIdentitiesBySubjectsRow{
		UserSubjectID:   userSubjectID,
		ExternalSubject: pgtype.Text{String: externalSubject, Valid: externalSubject != ""},
	}
}

// A request whose subject already exists resolves directly, without ever
// touching the identity-binding table.
func TestSubjectResolver_ExactSubjectMatchSkipsIdentityLookup(t *testing.T) {
	u := makeUser("00000000-0000-0000-0000-000000000001", "usr_cloud_a", time.Now())
	store := &fakeSubjectUserStore{
		bySubject:  map[string]db.MulticaUser{"usr_cloud_a": u},
		byEmail:    map[string]db.MulticaUser{},
		identities: []db.ListAuthIdentitiesBySubjectsRow{makeIdentity("usr_cloud_a", "casdoor-sub-1")},
	}
	resolve := NewSubjectResolver(store)

	got, err := resolve(context.Background(), "usr_cloud_a", "uni-1", "tester", "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if got != util.UUIDToString(u.ID) {
		t.Fatalf("got %q, want %q", got, util.UUIDToString(u.ID))
	}
	if store.identityCalls != 0 {
		t.Fatalf("identity table consulted on exact hit: %d calls", store.identityCalls)
	}
	if store.createCalls != 0 {
		t.Fatalf("unexpected auto-provision on exact hit")
	}
}

// Regression test for the identity split-brain: a user who was provisioned
// under the raw Casdoor sub (cloud translation had failed) must still resolve
// when later requests arrive with the cloud-api subject, because cs-user bound
// the two in user_auth_identities. Before the fix this auto-provisioned a
// second user and every pre-existing workspace 404'd.
func TestSubjectResolver_ResolvesCloudSubjectViaCasdoorBinding(t *testing.T) {
	u := makeUser("00000000-0000-0000-0000-000000000002", "165ecacf-raw-casdoor-sub", time.Now())
	store := &fakeSubjectUserStore{
		bySubject:  map[string]db.MulticaUser{u.SubjectID.String: u},
		byEmail:    map[string]db.MulticaUser{},
		identities: []db.ListAuthIdentitiesBySubjectsRow{makeIdentity("usr_ac256261", u.SubjectID.String)},
	}
	resolve := NewSubjectResolver(store)

	got, err := resolve(context.Background(), "usr_ac256261", "uni-1", "tester", "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if got != util.UUIDToString(u.ID) {
		t.Fatalf("got %q, want bound user %q", got, util.UUIDToString(u.ID))
	}
	if store.createCalls != 0 {
		t.Fatalf("auto-provisioned a duplicate despite identity binding")
	}
	if store.setSubjCalls != 0 {
		t.Fatalf("clobbered the bound user's subject_id")
	}
}

// The reverse direction: requests carrying the raw Casdoor sub (translator
// fell back) must resolve to the user keyed by the cloud subject.
func TestSubjectResolver_ResolvesRawSubjectViaReverseBinding(t *testing.T) {
	u := makeUser("00000000-0000-0000-0000-000000000003", "usr_48b35a2c", time.Now())
	store := &fakeSubjectUserStore{
		bySubject:  map[string]db.MulticaUser{u.SubjectID.String: u},
		byEmail:    map[string]db.MulticaUser{},
		identities: []db.ListAuthIdentitiesBySubjectsRow{makeIdentity(u.SubjectID.String, "aadbc069-raw")},
	}
	resolve := NewSubjectResolver(store)

	got, err := resolve(context.Background(), "aadbc069-raw", "uni-1", "tester", "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if got != util.UUIDToString(u.ID) {
		t.Fatalf("got %q, want bound user %q", got, util.UUIDToString(u.ID))
	}
	if store.createCalls != 0 {
		t.Fatalf("auto-provisioned a duplicate despite identity binding")
	}
}

// Identity links form a star around the cloud subject; resolving from one
// leaf must reach users keyed by a sibling leaf.
func TestSubjectResolver_ExpandsLinkedSubjectsTransitively(t *testing.T) {
	u := makeUser("00000000-0000-0000-0000-000000000004", "phone-sub-p2", time.Now())
	store := &fakeSubjectUserStore{
		bySubject: map[string]db.MulticaUser{u.SubjectID.String: u},
		byEmail:   map[string]db.MulticaUser{},
		identities: []db.ListAuthIdentitiesBySubjectsRow{
			makeIdentity("usr_cloud", "phone-sub-p1"),
			makeIdentity("usr_cloud", "phone-sub-p2"),
		},
	}
	resolve := NewSubjectResolver(store)

	got, err := resolve(context.Background(), "phone-sub-p1", "uni-1", "tester", "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if got != util.UUIDToString(u.ID) {
		t.Fatalf("got %q, want bound user %q", got, util.UUIDToString(u.ID))
	}
}

// When duplicate users already exist inside one linked subject set, resolve
// deterministically to the oldest account instead of provisioning yet another.
func TestSubjectResolver_MultipleLinkedUsers_PicksOldest(t *testing.T) {
	old := makeUser("00000000-0000-0000-0000-000000000005", "aadbc069-raw", time.Now().Add(-24*time.Hour))
	dup := makeUser("00000000-0000-0000-0000-000000000006", "usr_89fa7287", time.Now())
	store := &fakeSubjectUserStore{
		bySubject: map[string]db.MulticaUser{
			old.SubjectID.String: old,
			dup.SubjectID.String: dup,
		},
		byEmail: map[string]db.MulticaUser{},
		identities: []db.ListAuthIdentitiesBySubjectsRow{
			makeIdentity(dup.SubjectID.String, old.SubjectID.String),
			makeIdentity(dup.SubjectID.String, "github-sub-x"),
		},
	}
	resolve := NewSubjectResolver(store)

	// Incoming subject is in the binding graph but matches no user directly,
	// so resolution must go through the identity links and find both dupes.
	got, err := resolve(context.Background(), "github-sub-x", "uni-1", "tester", "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if got != util.UUIDToString(old.ID) {
		t.Fatalf("got %q, want oldest user %q", got, util.UUIDToString(old.ID))
	}
	if store.createCalls != 0 {
		t.Fatalf("auto-provisioned despite linked users")
	}
}

// Standalone deployments have no user_auth_identities table (cs-user is not
// co-located). The lookup must degrade gracefully and keep the prior
// auto-provision behaviour.
func TestSubjectResolver_IdentityTableMissing_FallsBackToProvision(t *testing.T) {
	store := &fakeSubjectUserStore{
		bySubject:   map[string]db.MulticaUser{},
		byEmail:     map[string]db.MulticaUser{},
		identityErr: &pgconn.PgError{Code: "42P01", Message: `relation "user_auth_identities" does not exist`},
	}
	resolve := NewSubjectResolver(store)

	got, err := resolve(context.Background(), "usr_new", "uni-1", "newbie", "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if got == "" {
		t.Fatalf("expected a provisioned user id")
	}
	if store.createCalls != 1 {
		t.Fatalf("createCalls = %d, want 1", store.createCalls)
	}
	if store.setSubjCalls != 1 {
		t.Fatalf("setSubjCalls = %d, want 1 (bind subject on provision)", store.setSubjCalls)
	}
}

// Baseline: no identity rows at all -> auto-provision, as before.
func TestSubjectResolver_NoIdentityRows_Provisions(t *testing.T) {
	store := &fakeSubjectUserStore{
		bySubject: map[string]db.MulticaUser{},
		byEmail:   map[string]db.MulticaUser{},
	}
	resolve := NewSubjectResolver(store)

	got, err := resolve(context.Background(), "usr_brand_new", "uni-1", "newbie", "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if got == "" {
		t.Fatalf("expected a provisioned user id")
	}
	if store.createCalls != 1 {
		t.Fatalf("createCalls = %d, want 1", store.createCalls)
	}
	if store.setSubjCalls != 1 {
		t.Fatalf("setSubjCalls = %d, want 1", store.setSubjCalls)
	}
}

// Existing adopt-by-email behaviour must survive the refactor: when the
// synthetic email is already owned by a subject-less account, bind the
// incoming subject to it instead of erroring.
func TestSubjectResolver_AdoptsExistingUserByEmail(t *testing.T) {
	existing := makeUser("00000000-0000-0000-0000-000000000007", "", time.Now())
	existing.SubjectID = pgtype.Text{}
	existing.Email = "person@example.com"
	store := &fakeSubjectUserStore{
		bySubject: map[string]db.MulticaUser{},
		byEmail:   map[string]db.MulticaUser{"person@example.com": existing},
		createErr: &pgconn.PgError{Code: "23505", Message: "duplicate key value violates unique constraint"},
	}
	resolve := NewSubjectResolver(store)

	got, err := resolve(context.Background(), "usr_adopter", "uni-1", "Person", "person@example.com")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if got != util.UUIDToString(existing.ID) {
		t.Fatalf("got %q, want adopted user %q", got, util.UUIDToString(existing.ID))
	}
	if store.setSubjCalls != 1 {
		t.Fatalf("setSubjCalls = %d, want 1 (bind subject on adopt)", store.setSubjCalls)
	}
}

// A genuine two-identity-one-email collision must not hijack the account.
func TestSubjectResolver_RefusesAdoptionWhenEmailOwnedByOtherSubject(t *testing.T) {
	existing := makeUser("00000000-0000-0000-0000-000000000008", "usr_someone_else", time.Now())
	existing.Email = "shared@example.com"
	store := &fakeSubjectUserStore{
		bySubject: map[string]db.MulticaUser{},
		byEmail:   map[string]db.MulticaUser{"shared@example.com": existing},
		createErr: &pgconn.PgError{Code: "23505", Message: "duplicate key value violates unique constraint"},
	}
	resolve := NewSubjectResolver(store)

	_, err := resolve(context.Background(), "usr_intruder", "uni-1", "Intruder", "shared@example.com")
	if err == nil {
		t.Fatalf("expected refusal error, got success")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("expected the original unique-violation error, got ErrNoRows")
	}
}
