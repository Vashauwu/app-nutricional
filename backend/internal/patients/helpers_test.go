package patients_test

import "github.com/shopspring/decimal"

func decimalFrom(s string) (decimal.Decimal, error) { return decimal.NewFromString(s) }
