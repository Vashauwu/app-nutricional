package patients

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

func evidenceJSON(m map[string]string) []byte {
	b, _ := json.Marshal(m)
	return b
}

type Clinical struct {
	Conditions  []db.PatientCondition      `json:"conditions"`
	Allergies   []db.PatientAllergy        `json:"allergies"`
	Medications []db.PatientMedication     `json:"medications"`
	Preferences []db.PatientFoodPreference `json:"preferences"`
}

func (s *Service) Clinical(ctx context.Context, patient uuid.UUID) (Clinical, error) {
	var c Clinical
	var err error
	if c.Conditions, err = s.q.ListConditions(ctx, patient); err != nil {
		return c, err
	}
	if c.Allergies, err = s.q.ListAllergies(ctx, patient); err != nil {
		return c, err
	}
	if c.Medications, err = s.q.ListMedications(ctx, patient); err != nil {
		return c, err
	}
	c.Preferences, err = s.q.ListPreferences(ctx, patient)
	c.Conditions, c.Allergies, c.Medications, c.Preferences = nz(c.Conditions), nz(c.Allergies), nz(c.Medications), nz(c.Preferences)
	return c, err
}

func clean(s string, max int, field string, required bool, errs ValidationError) string {
	s = strings.TrimSpace(s)
	if required && s == "" {
		errs[field] = "este campo es obligatorio"
	}
	if len(s) > max {
		errs[field] = "es demasiado largo"
	}
	return s
}

func oneOf(v string, field string, errs ValidationError, allowed ...string) {
	for _, a := range allowed {
		if v == a {
			return
		}
	}
	errs[field] = "valor no permitido"
}

// ---------- Condiciones ----------
type ConditionInput struct{ Name, Details, Status string }

func (s *Service) SaveCondition(ctx context.Context, a Actor, patient uuid.UUID, id *uuid.UUID, in ConditionInput) (db.PatientCondition, error) {
	errs := ValidationError{}
	name := clean(in.Name, 200, "name", true, errs)
	details := clean(in.Details, 2000, "details", false, errs)
	oneOf(in.Status, "status", errs, "active", "resolved")
	if len(errs) > 0 {
		return db.PatientCondition{}, errs
	}
	var out db.PatientCondition
	var err error
	if id == nil {
		out, err = s.q.InsertCondition(ctx, db.InsertConditionParams{PatientID: patient, Name: name, Details: details, Status: in.Status})
	} else {
		out, err = s.q.UpdateCondition(ctx, db.UpdateConditionParams{ID: *id, PatientID: patient, Name: name, Details: details, Status: in.Status})
		err = notFound(err)
	}
	if err == nil {
		s.rec(ctx, a, "patient.condition", patient, map[string]any{"id": out.ID})
	}
	return out, err
}

func (s *Service) DeleteCondition(ctx context.Context, a Actor, patient, id uuid.UUID) error {
	return s.del(ctx, a, patient, id, "patient.condition_delete", func() (int64, error) {
		return s.q.DeleteCondition(ctx, db.DeleteConditionParams{ID: id, PatientID: patient})
	})
}

// ---------- Alergias ----------
type AllergyInput struct {
	Allergen, Reaction, Severity, Status string
	Aliases                              []string
}

func (s *Service) SaveAllergy(ctx context.Context, a Actor, patient uuid.UUID, id *uuid.UUID, in AllergyInput) (db.PatientAllergy, error) {
	errs := ValidationError{}
	allergen := clean(in.Allergen, 200, "allergen", true, errs)
	reaction := clean(in.Reaction, 500, "reaction", false, errs)
	oneOf(in.Severity, "severity", errs, "mild", "moderate", "severe")
	oneOf(in.Status, "status", errs, "active", "resolved")
	aliases := make([]string, 0, len(in.Aliases))
	for _, al := range in.Aliases {
		if al = strings.TrimSpace(al); al != "" && len(al) <= 100 {
			aliases = append(aliases, al)
		}
	}
	if len(aliases) > 30 {
		errs["aliases"] = "máximo 30 sinónimos"
	}
	if len(errs) > 0 {
		return db.PatientAllergy{}, errs
	}
	var out db.PatientAllergy
	var err error
	if id == nil {
		out, err = s.q.InsertAllergy(ctx, db.InsertAllergyParams{PatientID: patient, Allergen: allergen, Aliases: aliases, Reaction: reaction, Severity: in.Severity, Status: in.Status})
	} else {
		out, err = s.q.UpdateAllergy(ctx, db.UpdateAllergyParams{ID: *id, PatientID: patient, Allergen: allergen, Aliases: aliases, Reaction: reaction, Severity: in.Severity, Status: in.Status})
		err = notFound(err)
	}
	if err == nil {
		s.rec(ctx, a, "patient.allergy", patient, map[string]any{"id": out.ID})
	}
	return out, err
}

func (s *Service) DeleteAllergy(ctx context.Context, a Actor, patient, id uuid.UUID) error {
	return s.del(ctx, a, patient, id, "patient.allergy_delete", func() (int64, error) {
		return s.q.DeleteAllergy(ctx, db.DeleteAllergyParams{ID: id, PatientID: patient})
	})
}

// ---------- Medicamentos ----------
type MedicationInput struct {
	Name, Dose, Frequency, Kind, Status string
	StartDate, EndDate                  *time.Time
}

func optDate(t *time.Time) pgtype.Date {
	if t == nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: *t, Valid: true}
}

func (s *Service) SaveMedication(ctx context.Context, a Actor, patient uuid.UUID, id *uuid.UUID, in MedicationInput) (db.PatientMedication, error) {
	errs := ValidationError{}
	name := clean(in.Name, 200, "name", true, errs)
	dose := clean(in.Dose, 200, "dose", false, errs)
	freq := clean(in.Frequency, 200, "frequency", false, errs)
	kind := clean(in.Kind, 120, "kind", false, errs)
	oneOf(in.Status, "status", errs, "active", "ended")
	if in.StartDate != nil && in.EndDate != nil && in.EndDate.Before(*in.StartDate) {
		errs["end_date"] = "debe ser posterior al inicio"
	}
	if len(errs) > 0 {
		return db.PatientMedication{}, errs
	}
	var out db.PatientMedication
	var err error
	if id == nil {
		out, err = s.q.InsertMedication(ctx, db.InsertMedicationParams{PatientID: patient, Name: name, Dose: dose, Frequency: freq, StartDate: optDate(in.StartDate), EndDate: optDate(in.EndDate), Status: in.Status, Kind: kind})
	} else {
		out, err = s.q.UpdateMedication(ctx, db.UpdateMedicationParams{ID: *id, PatientID: patient, Name: name, Dose: dose, Frequency: freq, StartDate: optDate(in.StartDate), EndDate: optDate(in.EndDate), Status: in.Status, Kind: kind})
		err = notFound(err)
	}
	if err == nil {
		s.rec(ctx, a, "patient.medication", patient, map[string]any{"id": out.ID})
	}
	return out, err
}

func (s *Service) DeleteMedication(ctx context.Context, a Actor, patient, id uuid.UUID) error {
	return s.del(ctx, a, patient, id, "patient.medication_delete", func() (int64, error) {
		return s.q.DeleteMedication(ctx, db.DeleteMedicationParams{ID: id, PatientID: patient})
	})
}

// ---------- Preferencias ----------
type PreferenceInput struct{ FoodName, Type, Notes string }

func (s *Service) SavePreference(ctx context.Context, a Actor, patient uuid.UUID, id *uuid.UUID, in PreferenceInput) (db.PatientFoodPreference, error) {
	errs := ValidationError{}
	food := clean(in.FoodName, 200, "food_name", true, errs)
	notes := clean(in.Notes, 500, "notes", false, errs)
	oneOf(in.Type, "preference_type", errs, "favorite", "avoid", "restriction", "other")
	if len(errs) > 0 {
		return db.PatientFoodPreference{}, errs
	}
	var out db.PatientFoodPreference
	var err error
	if id == nil {
		out, err = s.q.InsertPreference(ctx, db.InsertPreferenceParams{PatientID: patient, FoodName: food, PreferenceType: in.Type, Notes: notes})
	} else {
		out, err = s.q.UpdatePreference(ctx, db.UpdatePreferenceParams{ID: *id, PatientID: patient, FoodName: food, PreferenceType: in.Type, Notes: notes})
		err = notFound(err)
	}
	if err == nil {
		s.rec(ctx, a, "patient.preference", patient, map[string]any{"id": out.ID})
	}
	return out, err
}

func (s *Service) DeletePreference(ctx context.Context, a Actor, patient, id uuid.UUID) error {
	return s.del(ctx, a, patient, id, "patient.preference_delete", func() (int64, error) {
		return s.q.DeletePreference(ctx, db.DeletePreferenceParams{ID: id, PatientID: patient})
	})
}

func (s *Service) del(ctx context.Context, a Actor, patient, id uuid.UUID, action string, run func() (int64, error)) error {
	n, err := run()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.rec(ctx, a, action, patient, map[string]any{"id": id})
	return nil
}
