package cost

import "strings"

// defaultPriceEntry is one row of the pylon-parity default price table. Prices
// are nano-USD per 1,000,000 tokens (the USD-per-1M value × NanoUSD, written as
// an exact integer literal so no float rounding enters the money path).
type defaultPriceEntry struct {
	prefix     string
	inputNano  int64
	outputNano int64
}

// defaultPriceTable mirrors pylon gateway_analytics.MODEL_PRICING_DEFAULTS
// (values in USD per 1M tokens) scaled to nano-USD. ORDER IS LOAD-BEARING:
// pylon iterates the dict in insertion order and matches the FIRST prefix that
// model_name.startswith(prefix) — so "gpt-4o-mini" MUST precede "gpt-4o" which
// MUST precede "gpt-4-turbo" / "gpt-4", or a shorter prefix would greedily
// shadow a longer, more-specific one. A Go map would iterate randomly and break
// parity; this ordered slice preserves the exact pylon semantics.
//
// USD/1M → nano-USD/1M: multiply by 1e9. e.g. 0.15 → 150_000_000; 2.50 →
// 2_500_000_000; 0.075 → 75_000_000.
var defaultPriceTable = []defaultPriceEntry{
	{"gpt-4o-mini", 150_000_000, 600_000_000},
	{"gpt-4o", 2_500_000_000, 10_000_000_000},
	{"gpt-4-turbo", 10_000_000_000, 30_000_000_000},
	{"gpt-4", 30_000_000_000, 60_000_000_000},
	{"gpt-3.5-turbo", 500_000_000, 1_500_000_000},
	{"claude-3-5-sonnet", 3_000_000_000, 15_000_000_000},
	{"claude-3-5-haiku", 800_000_000, 4_000_000_000},
	{"claude-3-opus", 15_000_000_000, 75_000_000_000},
	{"claude-3-haiku", 250_000_000, 1_250_000_000},
	{"claude-sonnet-4", 3_000_000_000, 15_000_000_000},
	{"claude-opus-4", 15_000_000_000, 75_000_000_000},
	{"o1-mini", 3_000_000_000, 12_000_000_000},
	{"o1-pro", 150_000_000_000, 600_000_000_000},
	{"o1", 15_000_000_000, 60_000_000_000},
	{"gemini-1.5-flash", 75_000_000, 300_000_000},
	{"gemini-1.5-pro", 1_250_000_000, 5_000_000_000},
	{"gemini-2.0-flash", 100_000_000, 400_000_000},
	{"amazon.titan-text-express", 200_000_000, 600_000_000},
	{"amazon.titan-text-lite", 150_000_000, 200_000_000},
	{"anthropic.claude-3-sonnet", 3_000_000_000, 15_000_000_000},
	{"anthropic.claude-3-haiku", 250_000_000, 1_250_000_000},
	{"mistral-large", 2_000_000_000, 6_000_000_000},
	{"mistral-small", 100_000_000, 300_000_000},
}

// fallbackInputNano / fallbackOutputNano are pylon's ultimate default when no
// prefix matches: 1.0 / 3.0 USD per 1M tokens.
const (
	fallbackInputNano  int64 = 1_000_000_000
	fallbackOutputNano int64 = 3_000_000_000
)

// defaultPrice returns the pylon-parity default price for a model name, matching
// the FIRST prefix (case-insensitive, insertion order) as pylon does, else the
// ultimate 1.0/3.0 USD fallback. Source is "default" on a table hit and
// "fallback" on the ultimate default, so a metering gap is observable.
func defaultPrice(model string) Price {
	lower := strings.ToLower(model)
	for _, e := range defaultPriceTable {
		if strings.HasPrefix(lower, e.prefix) {
			return Price{InputNanoPer1M: e.inputNano, OutputNanoPer1M: e.outputNano, Source: "default"}
		}
	}
	return Price{InputNanoPer1M: fallbackInputNano, OutputNanoPer1M: fallbackOutputNano, Source: "fallback"}
}
