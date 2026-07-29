package com.example.ingest_service;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class TomTomAccountQuotaManager {

    public static final String PROVIDER = "tomtom";

    private final TomTomAccountPool accountPool;
    private final TrafficRequestBudget requestBudget;
    private final TomTomAccountAvailability availability;

    @Autowired
    public TomTomAccountQuotaManager(
        TomTomAccountPool accountPool,
        TrafficRequestBudget requestBudget,
        TomTomAccountAvailability availability
    ) {
        this.accountPool = accountPool;
        this.requestBudget = requestBudget;
        this.availability = availability;
    }

    TomTomAccountQuotaManager(
        TomTomAccountPool accountPool,
        TrafficRequestBudget requestBudget
    ) {
        this(accountPool, requestBudget, new TomTomAccountAvailability(accountPool));
    }

    public Optional<AccountReservation> reserveUpTo(
        String product,
        long requestedCalls,
        int hardStopPerAccount
    ) {
        if (requestedCalls <= 0 || hardStopPerAccount <= 0) {
            return Optional.empty();
        }

        List<AccountCandidate> candidates = accountPool.accounts().stream()
            .filter(account -> availability.isAvailable(account.id()))
            .map(account -> candidate(account, product, hardStopPerAccount))
            .filter(candidate -> candidate.remaining() > 0)
            .sorted(
                Comparator.comparingLong(AccountCandidate::remaining)
                    .reversed()
                    .thenComparing(candidate -> candidate.account().id())
            )
            .toList();

        for (AccountCandidate candidate : candidates) {
            int calls = (int) Math.min(
                Math.min(Integer.MAX_VALUE, requestedCalls),
                candidate.remaining()
            );
            TrafficRequestBudget.MonthlyReservation reservation =
                requestBudget.reserveMonthlyForAccount(
                    PROVIDER,
                    candidate.account().id(),
                    product,
                    calls,
                    hardStopPerAccount
                );
            if (reservation.allowed()) {
                return Optional.of(new AccountReservation(candidate.account(), reservation));
            }
        }
        return Optional.empty();
    }

    public Optional<AccountReservation> reserveForAccount(
        TomTomAccount account,
        String product,
        int requestedCalls,
        int hardStopPerAccount
    ) {
        if (
            account == null
                || requestedCalls <= 0
                || hardStopPerAccount <= 0
                || !availability.isAvailable(account.id())
                || accountPool.accounts().stream().noneMatch(
                    configured -> configured.id().equals(account.id())
                )
        ) {
            return Optional.empty();
        }
        int calls = (int) Math.min(Integer.MAX_VALUE, requestedCalls);
        TrafficRequestBudget.MonthlyReservation reservation =
            requestBudget.reserveMonthlyForAccount(
                PROVIDER,
                account.id(),
                product,
                calls,
                hardStopPerAccount
            );
        return reservation.allowed()
            ? Optional.of(new AccountReservation(account, reservation))
            : Optional.empty();
    }

    public List<AccountQuotaSnapshot> snapshots(
        String product,
        int targetPerAccount,
        int hardStopPerAccount,
        int allowancePerAccount
    ) {
        return accountPool.accounts().stream()
            .map(account -> {
                TrafficRequestBudget.MonthlyUsage usage = requestBudget.monthlyUsageForAccount(
                    PROVIDER,
                    account.id(),
                    product
                );
                TomTomAccountAvailability.AccountAvailabilitySnapshot accountAvailability =
                    availability.snapshot(account.id());
                return new AccountQuotaSnapshot(
                    account.id(),
                    usage.requestsUsed(),
                    Math.max(0, targetPerAccount),
                    Math.max(0, hardStopPerAccount),
                    Math.max(0, allowancePerAccount),
                    usage.periodStart(),
                    usage.periodEnd(),
                    accountAvailability.state().name(),
                    accountAvailability.retryOn()
                );
            })
            .toList();
    }

    public void release(AccountReservation reservation, long callsToRelease) {
        if (reservation == null || callsToRelease <= 0) {
            return;
        }
        requestBudget.releaseMonthly(
            reservation.budgetReservation(),
            (int) Math.min(Integer.MAX_VALUE, callsToRelease)
        );
    }

    public int configuredAccountCount() {
        return accountPool.size();
    }

    public List<TomTomAccount> configuredAccounts() {
        return accountPool.accounts();
    }

    public int availableAccountCount() {
        return (int) accountPool.accounts().stream()
            .filter(account -> availability.isAvailable(account.id()))
            .count();
    }

    public Optional<TomTomAccount> firstAccount() {
        return accountPool.accounts().stream()
            .filter(account -> availability.isAvailable(account.id()))
            .findFirst();
    }

    public boolean hasAvailableAccount() {
        return availability.hasAvailableAccount();
    }

    public void markAuthorizationFailed(String accountId) {
        availability.markAuthorizationFailed(accountId);
    }

    public void markCreditsExhausted(String accountId) {
        availability.markCreditsExhausted(accountId);
    }

    public void markAvailable(String accountId) {
        availability.markAvailable(accountId);
    }

    private AccountCandidate candidate(
        TomTomAccount account,
        String product,
        int hardStopPerAccount
    ) {
        long used = requestBudget.monthlyUsageForAccount(
            PROVIDER,
            account.id(),
            product
        ).requestsUsed();
        return new AccountCandidate(
            account,
            Math.max(0, (long) hardStopPerAccount - used)
        );
    }

    private record AccountCandidate(TomTomAccount account, long remaining) {}

    public record AccountReservation(
        TomTomAccount account,
        TrafficRequestBudget.MonthlyReservation budgetReservation
    ) {
        public long callsReserved() {
            return budgetReservation.callsReserved();
        }

        public long requestsUsed() {
            return budgetReservation.requestsUsed();
        }
    }

    public record AccountQuotaSnapshot(
        String accountId,
        long requestsUsed,
        int target,
        int hardStop,
        int allowance,
        LocalDate periodStart,
        LocalDate periodEnd,
        String availability,
        LocalDate retryOn
    ) {
        public AccountQuotaSnapshot(
            String accountId,
            long requestsUsed,
            int target,
            int hardStop,
            int allowance,
            LocalDate periodStart,
            LocalDate periodEnd
        ) {
            this(
                accountId,
                requestsUsed,
                target,
                hardStop,
                allowance,
                periodStart,
                periodEnd,
                TomTomAccountAvailability.State.AVAILABLE.name(),
                null
            );
        }
    }
}
