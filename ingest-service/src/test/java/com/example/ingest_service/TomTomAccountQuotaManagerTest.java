package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class TomTomAccountQuotaManagerTest {

    private static final String PRODUCT = "traffic-vector";
    private static final LocalDate START = LocalDate.of(2026, 7, 1);
    private static final LocalDate END = LocalDate.of(2026, 8, 1);

    @Test
    void reservesAgainstTheOnlyConfiguredAccount() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        TomTomAccountQuotaManager manager = manager("primary-key", "", false, budget);
        givenUsage(budget, "primary", 10_000);
        givenAllowedReservation(budget, "primary", 8, 10_008);

        Optional<TomTomAccountQuotaManager.AccountReservation> result =
            manager.reserveUpTo(PRODUCT, 8, 195_000);

        assertThat(result).get().satisfies(reservation -> {
            assertThat(reservation.account().id()).isEqualTo("primary");
            assertThat(reservation.callsReserved()).isEqualTo(8);
        });
    }

    @Test
    void choosesTheAccountWithMoreRemainingRoom() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        TomTomAccountQuotaManager manager = manager(
            "primary-key",
            "secondary-key",
            true,
            budget
        );
        givenUsage(budget, "primary", 180_000);
        givenUsage(budget, "secondary", 40_000);
        givenAllowedReservation(budget, "secondary", 8, 40_008);

        Optional<TomTomAccountQuotaManager.AccountReservation> result =
            manager.reserveUpTo(PRODUCT, 8, 195_000);

        assertThat(result).get().satisfies(reservation ->
            assertThat(reservation.account().id()).isEqualTo("secondary")
        );
    }

    @Test
    void skipsAQuarantinedAccountEvenWhenItHasMoreQuota() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        TomTomAccountPool pool = new TomTomAccountPool(
            new TrafficProps("primary-key", 60, "tile", 10, "", 4, 500, 0, 0, 0, true),
            new TomTomAccountsProps("secondary-key", true)
        );
        TomTomAccountAvailability availability = new TomTomAccountAvailability(pool);
        availability.markCreditsExhausted("secondary");
        TomTomAccountQuotaManager manager = new TomTomAccountQuotaManager(
            pool,
            budget,
            availability
        );
        givenUsage(budget, "primary", 100_000);
        givenUsage(budget, "secondary", 0);
        givenAllowedReservation(budget, "primary", 8, 100_008);

        Optional<TomTomAccountQuotaManager.AccountReservation> result =
            manager.reserveUpTo(PRODUCT, 8, 195_000);

        assertThat(result).get().satisfies(reservation ->
            assertThat(reservation.account().id()).isEqualTo("primary")
        );
        assertThat(manager.availableAccountCount()).isEqualTo(1);
        assertThat(manager.snapshots(PRODUCT, 190_000, 195_000, 200_000))
            .filteredOn(snapshot -> snapshot.accountId().equals("secondary"))
            .extracting(TomTomAccountQuotaManager.AccountQuotaSnapshot::availability)
            .containsExactly("CREDITS_EXHAUSTED");
    }

    @Test
    void reservesOnlyWhatFitsNearAnAccountHardStop() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        TomTomAccountQuotaManager manager = manager("primary-key", "", false, budget);
        givenUsage(budget, "primary", 194_997);
        givenAllowedReservation(budget, "primary", 3, 195_000);

        Optional<TomTomAccountQuotaManager.AccountReservation> result =
            manager.reserveUpTo(PRODUCT, 8, 195_000);

        assertThat(result).get().satisfies(reservation ->
            assertThat(reservation.callsReserved()).isEqualTo(3)
        );
    }

    @Test
    void quotaSnapshotsContainLabelsAndTotalsButNoKeys() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        TomTomAccountQuotaManager manager = manager(
            "primary-secret",
            "secondary-secret",
            true,
            budget
        );
        givenUsage(budget, "primary", 12_000);
        givenUsage(budget, "secondary", 34_000);

        var snapshots = manager.snapshots(PRODUCT, 190_000, 195_000, 200_000);

        assertThat(snapshots)
            .extracting(TomTomAccountQuotaManager.AccountQuotaSnapshot::accountId)
            .containsExactly("primary", "secondary");
        assertThat(snapshots).extracting(Object::toString)
            .allSatisfy(text -> assertThat(text)
                .doesNotContain("primary-secret")
                .doesNotContain("secondary-secret"));
    }

    @Test
    void releaseUsesTheOriginalAccountReservation() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        TomTomAccountQuotaManager manager = manager("primary-key", "", false, budget);
        TrafficRequestBudget.MonthlyReservation budgetReservation = reservation(
            "primary",
            8,
            8
        );
        TomTomAccountQuotaManager.AccountReservation reservation =
            new TomTomAccountQuotaManager.AccountReservation(
                new TomTomAccount("primary", "primary-key"),
                budgetReservation
            );

        manager.release(reservation, 3);

        verify(budget).releaseMonthly(budgetReservation, 3);
    }

    private static TomTomAccountQuotaManager manager(
        String primaryKey,
        String secondaryKey,
        boolean secondaryEnabled,
        TrafficRequestBudget budget
    ) {
        TomTomAccountPool pool = new TomTomAccountPool(
            new TrafficProps(primaryKey, 60, "tile", 10, "", 4, 500, 0, 0, 0, true),
            new TomTomAccountsProps(secondaryKey, secondaryEnabled)
        );
        return new TomTomAccountQuotaManager(pool, budget);
    }

    private static void givenUsage(TrafficRequestBudget budget, String accountId, long used) {
        when(budget.monthlyUsageForAccount("tomtom", accountId, PRODUCT))
            .thenReturn(new TrafficRequestBudget.MonthlyUsage(
                used,
                START,
                END,
                "tomtom",
                accountId,
                PRODUCT
            ));
    }

    private static void givenAllowedReservation(
        TrafficRequestBudget budget,
        String accountId,
        int calls,
        long used
    ) {
        when(budget.reserveMonthlyForAccount(
            "tomtom",
            accountId,
            PRODUCT,
            calls,
            195_000
        )).thenReturn(reservation(accountId, calls, used));
    }

    private static TrafficRequestBudget.MonthlyReservation reservation(
        String accountId,
        int calls,
        long used
    ) {
        return new TrafficRequestBudget.MonthlyReservation(
            true,
            calls,
            used,
            195_000,
            START,
            END,
            "tomtom",
            accountId,
            PRODUCT
        );
    }
}
