package config

import "testing"

func TestValidateSignup(t *testing.T) {
	cases := []struct {
		name string
		c    Config
		ok   bool
	}{
		{"producción sin confirmar correo: rechazado", Config{Env: "production", SignupEnabled: true}, false},
		{"producción con confirmación", Config{Env: "production", SignupEnabled: true, SignupRequireEmailVerification: true}, true},
		{"staging (cuentas de ejemplo) sin confirmar", Config{Env: "production", SignupEnabled: true, AllowDemoAccounts: true}, true},
		{"desarrollo sin confirmar", Config{Env: "development", SignupEnabled: true}, true},
		{"registro apagado", Config{Env: "production"}, true},
	}
	for _, tc := range cases {
		if err := tc.c.Validate(); (err == nil) != tc.ok {
			t.Errorf("%s: err = %v", tc.name, err)
		}
	}
}
