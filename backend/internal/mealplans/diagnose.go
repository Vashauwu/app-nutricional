package mealplans

import (
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// diagnoseBody revisa un cuerpo de guardado que no se pudo decodificar y señala qué campo falla, con el mismo
// formato de rutas que validate. El caso típico es un platillo de demostración del navegador, cuyo id no es UUID.
// Devuelve vacío si no encuentra una causa concreta.
func diagnoseBody(raw []byte) ValidationError {
	var loose struct {
		Days []struct {
			Slots []struct {
				ID    string `json:"id"`
				Items []struct {
					ID       string `json:"id"`
					DishID   string `json:"dish_id"`
					Servings any    `json:"servings"`
				} `json:"items"`
			} `json:"slots"`
		} `json:"days"`
		Targets struct {
			Equivalents map[string]any `json:"equivalents"`
		} `json:"targets"`
	}
	errs := ValidationError{}
	if err := json.Unmarshal(raw, &loose); err != nil {
		return errs
	}
	badUUID := func(s string) bool { _, err := uuid.Parse(s); return s != "" && err != nil }
	badNum := func(v any) bool {
		switch x := v.(type) {
		case nil, float64:
			return false
		case string:
			_, err := decimal.NewFromString(x)
			return err != nil
		}
		return true
	}
	for di, d := range loose.Days {
		for si, s := range d.Slots {
			if badUUID(s.ID) {
				errs[fmt.Sprintf("days[%d].slots[%d].id", di, si)] = "el identificador del tiempo de comida no es válido"
			}
			for ii, it := range s.Items {
				key := fmt.Sprintf("days[%d].slots[%d].items[%d]", di, si, ii)
				if badUUID(it.DishID) {
					errs[key+".dish_id"] = "este platillo no existe en el servidor (parece un platillo de demostración): quítalo del plan"
				}
				if badUUID(it.ID) {
					errs[key+".id"] = "el identificador del platillo en el plan no es válido"
				}
				if badNum(it.Servings) {
					errs[key+".servings"] = "las porciones deben ser un número"
				}
			}
		}
	}
	for code, v := range loose.Targets.Equivalents {
		if badNum(v) {
			errs["targets.equivalents."+code] = "debe ser un número"
		}
	}
	return errs
}
