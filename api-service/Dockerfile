FROM maven:3.9.9-eclipse-temurin-21 AS build
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

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/app.jar /app/app.jar

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health/liveness >/dev/null || exit 1
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
