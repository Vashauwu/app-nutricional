package agenda

import (
	"fmt"
	"strings"
	"time"
)

var kindLabel = map[string]string{"first": "Primera consulta", "follow_up": "Consulta de seguimiento", "other": "Consulta"}

func icsEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`, "\r", "")
	return r.Replace(s)
}

// fold parte las líneas largas a 75 octetos como pide RFC 5545 (sin cortar caracteres multibyte).
func fold(line string) string {
	if len(line) <= 75 {
		return line
	}
	var b strings.Builder
	cur := 0
	for _, r := range line {
		n := len(string(r))
		if cur+n > 75 {
			b.WriteString("\r\n ")
			cur = 1
		}
		b.WriteRune(r)
		cur += n
	}
	return b.String()
}

func icsTime(t time.Time) string { return t.UTC().Format("20060102T150405Z") }

// buildICS genera el calendario de consultas. Las canceladas se publican con STATUS:CANCELLED para que
// el calendario externo las quite en lugar de dejarlas como citas fantasma.
func buildICS(list []View, now time.Time) []byte {
	var b strings.Builder
	w := func(s string) { b.WriteString(fold(s)); b.WriteString("\r\n") }
	w("BEGIN:VCALENDAR")
	w("VERSION:2.0")
	w("PRODID:-//Plataforma nutricional//Consultas//ES")
	w("CALSCALE:GREGORIAN")
	w("METHOD:PUBLISH")
	w("X-WR-CALNAME:Consultas de nutrición")
	w("REFRESH-INTERVAL;VALUE=DURATION:PT15M")
	w("X-PUBLISHED-TTL:PT15M")
	for _, a := range list {
		status := "CONFIRMED"
		switch a.Status {
		case "cancelled":
			status = "CANCELLED"
		case "scheduled":
			status = "CONFIRMED"
		}
		desc := kindLabel[a.Kind]
		if a.Mode == "online" {
			desc += " (en línea)"
		}
		w("BEGIN:VEVENT")
		w("UID:consulta-" + a.ID.String() + "@nutri")
		w("DTSTAMP:" + icsTime(now))
		w("DTSTART:" + icsTime(a.StartsAt))
		w("DTEND:" + icsTime(a.EndsAt))
		w("SUMMARY:" + icsEscape(fmt.Sprintf("%s · %s", kindLabel[a.Kind], a.PatientName)))
		w("DESCRIPTION:" + icsEscape(desc))
		if a.Place != "" {
			w("LOCATION:" + icsEscape(a.Place))
		}
		w("STATUS:" + status)
		w("END:VEVENT")
	}
	w("END:VCALENDAR")
	return []byte(b.String())
}
