package com.example.ingest_service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

@Entity
@Table(name = "traffic_provider_guard_status")
public class TrafficProviderGuardStatus {

    @Id
    @Column(name = "provider_name", nullable = false, length = 64)
    private String providerName;

    @Column(nullable = false, length = 32)
    private String state;

    @Column(nullable = false)
    private boolean halted;

    @Column(name = "failure_code", length = 64)
    private String failureCode;

    @Column(columnDefinition = "text")
    private String message;

    @Column(name = "details_json", columnDefinition = "text")
    private String detailsJson;

    @Column(name = "consecutive_null_cycles", nullable = false)
    private int consecutiveNullCycles;

    @Column(name = "consecutive_stale_cycles", nullable = false)
    private int consecutiveStaleCycles;

    @Column(name = "last_cycle_signature", length = 128)
    private String lastCycleSignature;

    @Column(name = "last_checked_at", nullable = false)
    private OffsetDateTime lastCheckedAt;

    @Column(name = "last_success_at")
    private OffsetDateTime lastSuccessAt;

    @Column(name = "last_failure_at")
    private OffsetDateTime lastFailureAt;

    @Column(name = "shutdown_triggered_at")
    private OffsetDateTime shutdownTriggeredAt;

    public String getProviderName() {
        return providerName;
    }

    public void setProviderName(String providerName) {
        this.providerName = providerName;
    }

    public String getState() {
        return state;
    }

    public void setState(String state) {
        this.state = state;
    }

    public boolean isHalted() {
        return halted;
    }

    public void setHalted(boolean halted) {
        this.halted = halted;
    }

    public String getFailureCode() {
        return failureCode;
    }

    public void setFailureCode(String failureCode) {
        this.failureCode = failureCode;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getDetailsJson() {
        return detailsJson;
    }

    public void setDetailsJson(String detailsJson) {
        this.detailsJson = detailsJson;
    }

    public int getConsecutiveNullCycles() {
        return consecutiveNullCycles;
    }

    public void setConsecutiveNullCycles(int consecutiveNullCycles) {
        this.consecutiveNullCycles = consecutiveNullCycles;
    }

    public int getConsecutiveStaleCycles() {
        return consecutiveStaleCycles;
    }

    public void setConsecutiveStaleCycles(int consecutiveStaleCycles) {
        this.consecutiveStaleCycles = consecutiveStaleCycles;
    }

    public String getLastCycleSignature() {
        return lastCycleSignature;
    }

    public void setLastCycleSignature(String lastCycleSignature) {
        this.lastCycleSignature = lastCycleSignature;
    }

    public OffsetDateTime getLastCheckedAt() {
        return lastCheckedAt;
    }

    public void setLastCheckedAt(OffsetDateTime lastCheckedAt) {
        this.lastCheckedAt = lastCheckedAt;
    }

    public OffsetDateTime getLastSuccessAt() {
        return lastSuccessAt;
    }

    public void setLastSuccessAt(OffsetDateTime lastSuccessAt) {
        this.lastSuccessAt = lastSuccessAt;
    }

    public OffsetDateTime getLastFailureAt() {
        return lastFailureAt;
    }

    public void setLastFailureAt(OffsetDateTime lastFailureAt) {
        this.lastFailureAt = lastFailureAt;
    }

    public OffsetDateTime getShutdownTriggeredAt() {
        return shutdownTriggeredAt;
    }

    public void setShutdownTriggeredAt(OffsetDateTime shutdownTriggeredAt) {
        this.shutdownTriggeredAt = shutdownTriggeredAt;
    }
}
