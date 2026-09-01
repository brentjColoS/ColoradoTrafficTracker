alter table traffic_speed_zone_sample
    drop constraint if exists traffic_speed_zone_sample_sample_id_fkey;

comment on table traffic_speed_zone_sample is
    'Durable speed-zone observations. sample_id joins traffic_sample.id while live and traffic_sample_archive.source_id after archival.';
