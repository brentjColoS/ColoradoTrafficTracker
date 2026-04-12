alter table corridor_ref
    add column if not exists geometry_source varchar(32) not null default 'unknown',
    add column if not exists geometry_updated_at timestamptz;

update corridor_ref
set geometry_source = case
        when geometry_json is not null and geometry_json <> '' then 'configured'
        else geometry_source
    end,
    geometry_updated_at = coalesce(geometry_updated_at, updated_at)
where geometry_json is not null
  and geometry_json <> '';

create index if not exists idx_corridor_ref_geometry_source
    on corridor_ref (geometry_source);
