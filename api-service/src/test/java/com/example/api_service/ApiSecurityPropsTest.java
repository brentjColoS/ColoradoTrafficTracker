package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ApiSecurityPropsTest {

    @Test
    void keySetSplitsTrimsAndDeduplicates() {
        ApiSecurityProps props = new ApiSecurityProps(true, " key-a, key-b ,key-a,, ");

        assertThat(props.keySet()).containsExactlyInAnyOrder("key-a", "key-b");
    }

    @Test
    void keySetIsEmptyWhenKeysBlank() {
        ApiSecurityProps props = new ApiSecurityProps(true, "   ");

        assertThat(props.keySet()).isEmpty();
    }
}
