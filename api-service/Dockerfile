FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /workspace

COPY pom.xml pom.xml
COPY common/pom.xml common/pom.xml
COPY routes-service/pom.xml routes-service/pom.xml
COPY ingest-service/pom.xml ingest-service/pom.xml
COPY api-service/pom.xml api-service/pom.xml

RUN mvn -q -DskipTests -pl api-service -am dependency:go-offline

COPY . .
RUN mvn -q -DskipTests -pl api-service -am package
RUN cp "$(find /workspace/api-service/target -maxdepth 1 -name '*.jar' ! -name '*.original' | head -n 1)" /workspace/app.jar

FROM eclipse-temurin:21.0.12_8-jre-jammy@sha256:eebd356ad7358b7094758e5787a6726f332917cfd56feab6457c56dab895cdbf
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/app.jar /app/app.jar

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health/liveness >/dev/null || exit 1
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
