FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml pom.xml
COPY common/pom.xml common/pom.xml
COPY routes-service/pom.xml routes-service/pom.xml
COPY ingest-service/pom.xml ingest-service/pom.xml
COPY api-service/pom.xml api-service/pom.xml

RUN mvn -q -DskipTests -pl routes-service -am dependency:go-offline

COPY . .
RUN mvn -q -DskipTests -pl routes-service -am package
RUN cp "$(find /workspace/routes-service/target -maxdepth 1 -name '*.jar' ! -name '*.original' | head -n 1)" /workspace/app.jar

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/app.jar /app/app.jar

EXPOSE 8081
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
