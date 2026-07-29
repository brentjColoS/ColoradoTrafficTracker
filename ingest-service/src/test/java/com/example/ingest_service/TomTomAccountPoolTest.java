package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TomTomAccountPoolTest {

    @Test
    void keepsTheExistingKeyAsTheOnlyAccountByDefault() {
        TomTomAccountPool pool = new TomTomAccountPool(
            trafficProps("primary-key"),
            new TomTomAccountsProps("", false, true)
        );

        assertThat(pool.accounts())
            .extracting(TomTomAccount::id)
            .containsExactly("primary");
        assertThat(pool.firstAccount()).get().extracting(TomTomAccount::apiKey).isEqualTo("primary-key");
    }

    @Test
    void addsAnExplicitlyEnabledSecondaryAccount() {
        TomTomAccountPool pool = new TomTomAccountPool(
            trafficProps("primary-key"),
            new TomTomAccountsProps("secondary-key", true, true)
        );

        assertThat(pool.accounts())
            .extracting(TomTomAccount::id)
            .containsExactly("primary", "secondary");
    }

    @Test
    void ignoresADisabledSecondaryCredential() {
        TomTomAccountPool pool = new TomTomAccountPool(
            trafficProps("primary-key"),
            new TomTomAccountsProps("secondary-key", false, true)
        );

        assertThat(pool.size()).isEqualTo(1);
        assertThat(pool.accounts())
            .extracting(TomTomAccount::id)
            .containsExactly("primary");
        assertThat(pool.configuredAccounts())
            .extracting(TomTomAccount::id)
            .containsExactly("primary", "secondary");
    }

    @Test
    void doesNotCountTheSameCredentialTwice() {
        TomTomAccountPool pool = new TomTomAccountPool(
            trafficProps("same-key"),
            new TomTomAccountsProps(" same-key ", true, true)
        );

        assertThat(pool.size()).isEqualTo(1);
        assertThat(pool.configuredAccounts()).hasSize(1);
    }

    @Test
    void accountTextNeverContainsTheCredential() {
        TomTomAccount account = new TomTomAccount("primary", "do-not-print-this");

        assertThat(account.toString())
            .contains("primary")
            .doesNotContain(account.apiKey());
    }

    private static TrafficProps trafficProps(String key) {
        return new TrafficProps(key, 60, "tile", 10, "", 4, 500, 35_000, 38_000, 40_000, true);
    }
}
