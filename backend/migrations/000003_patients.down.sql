DROP TABLE IF EXISTS consent_acceptances, consent_documents, patient_notes, patient_food_preferences,
    patient_medications, patient_allergies, patient_conditions, patient_measurements, patients CASCADE;
DROP FUNCTION IF EXISTS forbid_mutation();
