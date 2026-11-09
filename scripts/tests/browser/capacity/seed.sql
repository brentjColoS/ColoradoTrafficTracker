\set ON_ERROR_STOP on
set statement_timeout = '90s';
create temporary table capacity_anchor as select date_trunc('minute', now()) as at;
insert into corridor_ref(code,display_name,road_number,start_mile_marker,end_mile_marker,bbox)
values ('I25','Synthetic I25','I-25',271,208,'40.627367,-105.031128,39.700390,-104.970703'),
       ('I70','Synthetic I70','I-70',206,274,'39.797997,-106.437378,39.492291,-104.963837');

create temporary table capacity_samples as
select row_number() over () as source_id, c.corridor, n,
       a.at - make_interval(mins => n) as polled_at,
       c.speed + (n % 5) * 0.25 as speed
from (values ('I25',61.0),('I70',54.0)) c(corridor,speed)
cross join capacity_anchor a cross join generate_series(0, :days * 1440) n;
insert into traffic_sample(corridor,avg_current_speed,avg_freeflow_speed,min_current_speed,confidence,
                          polled_at,source_mode,speed_sample_count,incident_count)
select corridor,speed,70,speed-5,0.95,polled_at,'tile',8,0 from capacity_samples where n <= 43200;
insert into traffic_sample_archive(source_id,corridor,avg_current_speed,avg_freeflow_speed,min_current_speed,
                                  confidence,polled_at,archived_at,source_mode,speed_sample_count,incident_count)
select source_id+10000000,corridor,speed,70,speed-5,0.95,polled_at,now(),'tile',8,0
from capacity_samples where n > 43200;

create temporary table capacity_zones as
select 'I25'::text corridor,'I25-capacity-'||n zone_key,n zone_order,208+(n-1)*10.5 start_mm,208+n*10.5 end_mm
from generate_series(1,6) n
union all
select 'I70','I70-capacity-'||n,n,206+(n-1)*53.0/6,206+n*53.0/6 from generate_series(1,6) n
union all select 'I70','I70-259-270_274',7,259,270.274
union all select 'I70','I70-270_274-274',8,270.274,274;
insert into traffic_speed_zone_sample(sample_id,corridor,zone_key,zone_order,zone_label,start_mile_marker,
                                    end_mile_marker,posted_speed_mph,avg_current_speed,min_current_speed,
                                    speed_sample_count,polled_at)
select coalesce(live.id,s.source_id+10000000),s.corridor,z.zone_key,z.zone_order,z.zone_key,z.start_mm,z.end_mm,65,
       s.speed-z.zone_order*0.25,s.speed-5,8,s.polled_at
from capacity_samples s join capacity_zones z using(corridor)
left join traffic_sample live on live.corridor=s.corridor and live.polled_at=s.polled_at
where s.n <= 86400;

insert into traffic_incident_archive(source_id,sample_source_id,corridor,road_number,icon_category,
    travel_direction,closest_mile_marker,mile_marker_method,incident_provider,provider_event_id,
    normalized_category,polled_at,normalized_at,archived_at,geometry_type,geometry_json)
select source_id*24+incident,source_id+10000000,corridor,case when corridor='I25' then 'I-25' else 'I-70' end,1,
       case when corridor='I25' then 'N' else 'E' end,240,'provider','cdot',
       'legacy-'||floor(extract(epoch from polled_at)/3600)||'-'||incident,'CRASH',polled_at,polled_at,now(),
       'Point','[-105,39.75]' from capacity_samples cross join generate_series(0,23) incident where n > 43200 and n <= 86400;

insert into traffic_incident_event(provider,product,provider_event_id,normalized_status,normalized_category,
    incident_description,first_seen_at,last_seen_at,source_started_at,source_ended_at,active,latest_payload_hash,
    raw_event_json,geometry_type,geometry_json)
select 'cdot','capacity-fixture',c.corridor||'-event-'||n||'-'||variant,'CLOSED','CRASH','Synthetic capacity incident',
       a.at-make_interval(days=>n)-interval '1 hour',a.at-make_interval(days=>n),
       a.at-make_interval(days=>n)-interval '1 hour',a.at-make_interval(days=>n),false,'fixture','{}',
       'Point','[-105,39.75]'
from (values ('I25'),('I70')) c(corridor) cross join capacity_anchor a cross join generate_series(0,29) n
cross join generate_series(0,24) variant;
insert into traffic_incident_event_corridor(event_id,corridor,road_number,travel_direction,closest_mile_marker,
    mile_marker_method,first_matched_at,last_matched_at,active)
select id,split_part(provider_event_id,'-',1),case when provider_event_id like 'I25%' then 'I-25' else 'I-70' end,
       case when provider_event_id like 'I25%' then 'N' else 'E' end,240,'provider',first_seen_at,last_seen_at,false
from traffic_incident_event;
insert into traffic_incident_event_transition(event_id,occurred_at,transition_type,active,payload_hash,normalized_status,raw_event_json)
select id,first_seen_at,'FIRST_SEEN',true,'fixture','OPEN','{}' from traffic_incident_event
union all select id,last_seen_at,'INACTIVE',false,'fixture','CLOSED','{}' from traffic_incident_event;
insert into traffic_incident_event_corridor_transition(event_id,corridor,occurred_at,transition_type,active,
    road_number,travel_direction,closest_mile_marker,mile_marker_method)
select event_id,corridor,first_matched_at,'FIRST_MATCHED',true,road_number,travel_direction,closest_mile_marker,mile_marker_method
from traffic_incident_event_corridor;

insert into traffic_flow_cell_snapshot_current(corridor,observed_at,source_zoom,status,detail,cell_size_miles,
    total_cell_count,supported_cell_count,unique_source_path_count,duplicate_source_path_count)
select corridor,a.at,11,'AVAILABLE','Synthetic capacity fixture',0.5,112,112,112,0
from (values ('I25'),('I70')) c(corridor) cross join capacity_anchor a;
insert into traffic_flow_cell_current(corridor,cell_id,observed_at,start_mile_marker,end_mile_marker,direction,
    speed_mph,source_path_count,one_side_source_count,full_source_count,unknown_coverage_source_count,
    closure_evidence,covered_marker_miles,finest_source_span_miles,length_weighted_source_span_miles,
    coarsest_source_span_miles,coarsest_source_start_mile_marker,coarsest_source_end_mile_marker,quality)
select c.corridor,'capacity-'||n,a.at,c.start_mm+n*0.5,c.start_mm+(n+1)*0.5,
       case when c.corridor='I25' then 'N' else 'E' end,55,1,0,1,0,'NONE',0.5,0.5,0.5,0.5,
       c.start_mm+n*0.5,c.start_mm+(n+1)*0.5,'SUPPORTED'
from (values ('I25',208),('I70',206)) c(corridor,start_mm) cross join capacity_anchor a cross join generate_series(0,111) n;
insert into traffic_flow_cell_hourly(corridor,cell_id,direction,hour_start,start_mile_marker,end_mile_marker,
    source_zoom_min,source_zoom_max,observation_count,avg_speed_mph,min_speed_mph,max_speed_mph,
    full_cell_observation_count,partial_cell_observation_count,closure_observation_count,min_finest_source_span_miles,
    avg_length_weighted_source_span_miles,max_coarsest_source_span_miles,first_observed_at,last_observed_at)
select c.corridor,c.cell_id,c.direction,date_trunc('hour',a.at)-make_interval(hours=>n),c.start_mile_marker,c.end_mile_marker,
       11,11,60,55,50,60,60,0,0,0.5,0.5,0.5,
       date_trunc('hour',a.at)-make_interval(hours=>n),date_trunc('hour',a.at)-make_interval(hours=>n)+interval '59 minutes'
from traffic_flow_cell_current c cross join capacity_anchor a cross join generate_series(1,1440) n;

create role capacity_reader login;
grant connect on database postgres to capacity_reader;
grant usage on schema public to capacity_reader;
grant select on all tables in schema public to capacity_reader;
alter role capacity_reader set default_transaction_read_only=on;
analyze;
select json_build_object('anchor',a.at,'days',:days,'corridorRows',(select count(*) from capacity_samples),
    'zoneRows',(select count(*) from traffic_speed_zone_sample),'legacyRows',(select count(*) from traffic_incident_archive),
    'durableEvents',(select count(*) from traffic_incident_event),'flowHours',(select count(*) from traffic_flow_cell_hourly))
from capacity_anchor a;
