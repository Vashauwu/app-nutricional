// Package auth implementa autenticación, sesiones y autorización (MVP_SPEC §2, §5).
package auth

import (
	"errors"
	"unicode"

	"github.com/alexedwards/argon2id"
)

var hashParams = &argon2id.Params{Memory: 64 * 1024, Iterations: 3, Parallelism: 2, SaltLength: 16, KeyLength: 32}

var ErrWeakPassword = errors.New("la contraseña debe tener al menos 8 caracteres, con una letra y un número")

// ValidatePassword aplica la misma política que el frontend (la validación real es esta).
func ValidatePassword(pw string) error {
	if len(pw) < 8 || len(pw) > 128 {
		return ErrWeakPassword
	}
	var letter, digit bool
	for _, r := range pw {
		letter = letter || unicode.IsLetter(r)
		digit = digit || unicode.IsDigit(r)
	}
	if !letter || !digit {
		return ErrWeakPassword
	}
	return nil
}

func HashPassword(pw string) (string, error) { return argon2id.CreateHash(pw, hashParams) }

func VerifyPassword(pw, hash string) bool {
	ok, err := argon2id.ComparePasswordAndHash(pw, hash)
	return err == nil && ok
}

// dummyHash se compara cuando el correo no existe, para que el tiempo de
// respuesta no revele si la cuenta existe (§5.2).
var dummyHash, _ = argon2id.CreateHash("cuenta-inexistente-1", hashParams)
