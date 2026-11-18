package config

import "testing"

func TestValidateSignup(t *testing.T) {
	cases := []struct {
		name string
		c    Config
		ok   bool
	}{
		{"producción sin confirmar correo: rechazado", Config{Env: "production", SignupEnabled: true, TurnstileSiteKey: "s", TurnstileSecret: "k"}, false},
		{"producción con confirmación y captcha", Config{Env: "production", SignupEnabled: true, SignupRequireEmailVerification: true, TurnstileSiteKey: "s", TurnstileSecret: "k"}, true},
		{"producción abierta sin captcha: rechazado", Config{Env: "production", SignupEnabled: true, SignupRequireEmailVerification: true}, false},
		{"producción con solo la clave pública: rechazado", Config{Env: "production", SignupEnabled: true, SignupRequireEmailVerification: true, TurnstileSiteKey: "s"}, false},
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
