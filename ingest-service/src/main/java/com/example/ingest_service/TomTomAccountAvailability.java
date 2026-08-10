package com.example.ingest_service;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class TomTomAccountAvailability {

    public enum State {
        AVAILABLE,
        AUTH_FAILED,
        CREDITS_EXHAUSTED
    }

    private final TomTomAccountPool accountPool;
    private final Clock clock;
    private final Map<String, AccountState> stateByAccount = new ConcurrentHashMap<>();

    @Autowired
    public TomTomAccountAvailability(TomTomAccountPool accountPool) {
        this(accountPool, Clock.systemUTC());
    }

    TomTomAccountAvailability(TomTomAccountPool accountPool, Clock clock) {
        this.accountPool = accountPool;
        this.clock = clock;
    }

    public boolean isAvailable(String accountId) {
        AccountState current = stateByAccount.get(accountId);
        return current == null || current.state() == State.AVAILABLE;
    }

    public boolean hasAvailableAccount() {
        return accountPool.accounts().stream()
            .anyMatch(account -> isAvailable(account.id()));
    }

    public State state(String accountId) {
        return isAvailable(accountId)
            ? State.AVAILABLE
            : stateByAccount.get(accountId).state();
    }

    public void markAuthorizationFailed(String accountId) {
        stateByAccount.put(
            accountId,
            new AccountState(State.AUTH_FAILED, null, Instant.now(clock))
        );
    }

    public void markCreditsExhausted(String accountId) {
        LocalDate retryOn = YearMonth.from(today()).plusMonths(1).atDay(1);
        stateByAccount.put(
            accountId,
            new AccountState(State.CREDITS_EXHAUSTED, retryOn, Instant.now(clock))
        );
    }

    public void markAvailable(String accountId) {
        stateByAccount.remove(accountId);
    }

    public AccountAvailabilitySnapshot snapshot(String accountId) {
        AccountState current = stateByAccount.get(accountId);
        if (current == null || isAvailable(accountId)) {
            return new AccountAvailabilitySnapshot(accountId, State.AVAILABLE, null, null);
        }
        return new AccountAvailabilitySnapshot(
            accountId,
            current.state(),
            current.retryOn(),
            current.changedAt()
        );
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(ZoneOffset.UTC));
    }

    private record AccountState(State state, LocalDate retryOn, Instant changedAt) {}

    public record AccountAvailabilitySnapshot(
        String accountId,
        State state,
        LocalDate retryOn,
        Instant changedAt
    ) {}
}
