package com.example.ingest_service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class TomTomAccountPool {

    public static final String PRIMARY_ACCOUNT_ID = "primary";
    public static final String SECONDARY_ACCOUNT_ID = "secondary";

    private static final Logger log = LoggerFactory.getLogger(TomTomAccountPool.class);

    private final List<TomTomAccount> accounts;

    public TomTomAccountPool(TrafficProps trafficProps, TomTomAccountsProps accountsProps) {
        List<TomTomAccount> configured = new ArrayList<>(2);
        String primaryKey = clean(trafficProps.tomtomApiKey());
        String secondaryKey = clean(accountsProps.secondaryApiKey());

        if (!primaryKey.isEmpty()) {
            configured.add(new TomTomAccount(PRIMARY_ACCOUNT_ID, primaryKey));
        }

        if (accountsProps.secondaryEnabled()) {
            if (secondaryKey.isEmpty()) {
                log.warn("Secondary TomTom account is enabled but TOMTOM_SECONDARY_API_KEY is blank");
            } else if (sameSecret(primaryKey, secondaryKey)) {
                log.warn("Secondary TomTom account uses the primary credential and will not add quota capacity");
            } else {
                configured.add(new TomTomAccount(SECONDARY_ACCOUNT_ID, secondaryKey));
            }
        }

        this.accounts = List.copyOf(configured);
    }

    public List<TomTomAccount> accounts() {
        return accounts;
    }

    public Optional<TomTomAccount> firstAccount() {
        return accounts.stream().findFirst();
    }

    public boolean isEmpty() {
        return accounts.isEmpty();
    }

    public int size() {
        return accounts.size();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static boolean sameSecret(String left, String right) {
        if (left.isEmpty() || right.isEmpty()) {
            return false;
        }
        return MessageDigest.isEqual(
            left.getBytes(StandardCharsets.UTF_8),
            right.getBytes(StandardCharsets.UTF_8)
        );
    }
}
