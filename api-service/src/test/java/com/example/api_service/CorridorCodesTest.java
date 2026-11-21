package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;
import org.junit.jupiter.api.Test;

class CorridorCodesTest {
    @Test
    void trackedCodesKeepStrictAliasesAndIgnoreTheDefaultLocale() {
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));
            assertThat(CorridorCodes.trackedCorridor(" i25 ")).isEqualTo("I25");
            assertThat(CorridorCodes.trackedCorridor("i70")).isEqualTo("I70");
            for (String value : new String[] {null, "", " ", "I-25", "I-70", "US36", "I250"}) {
                assertThat(CorridorCodes.trackedCorridor(value)).isNull();
            }
            assertThat(CorridorCodes.normalizeCorridor(" us36 ")).isEqualTo("US36");
        } finally { Locale.setDefault(previous); }
    }
}
