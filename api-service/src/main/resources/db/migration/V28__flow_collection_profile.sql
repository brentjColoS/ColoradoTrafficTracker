alter table traffic_sample add column flow_collection_profile text;
alter table traffic_sample_archive add column flow_collection_profile text;
alter table traffic_flow_cell_snapshot_current add column flow_collection_profile text;
alter table traffic_flow_cell_hourly add column flow_collection_profile text;

-- Preserve unknown legacy provenance; do not infer or backfill old precision.
create view traffic_sample_collection_profiles as
select id as sample_ref_id, corridor, polled_at, flow_collection_profile, false as is_archived
from traffic_sample
union all
select source_id as sample_ref_id, corridor, polled_at, flow_collection_profile, true as is_archived
from traffic_sample_archive;
