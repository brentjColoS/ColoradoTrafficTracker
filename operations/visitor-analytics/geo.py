"""Optional, disk-backed city-area lookup. Never contacts a location service."""
import datetime as dt
import ipaddress
import logging
import math
import time
import unicodedata


def _name(value):
    if not isinstance(value, str): return ''
    return ' '.join(''.join(c for c in value if not unicodedata.category(c).startswith('C')).split())[:80]


def area_from_record(record):
    if not isinstance(record, dict): return None
    city = _name(record.get('city', {}).get('names', {}).get('en'))
    country = _name(record.get('country', {}).get('names', {}).get('en'))
    subdivisions = record.get('subdivisions') or []
    region = _name(subdivisions[0].get('names', {}).get('en')) if subdivisions else ''
    if not city or not (region or country): return None
    location = record.get('location') or {}
    radius = location.get('accuracy_radius')
    if radius is not None and (type(radius) not in (int, float) or not 0 <= radius <= 100): return None
    latitude, longitude = location.get('latitude'), location.get('longitude')
    coordinates = None
    if (type(latitude) in (int, float) and type(longitude) in (int, float)
            and math.isfinite(latitude) and math.isfinite(longitude)
            and -90 <= latitude <= 90 and -180 <= longitude <= 180):
        # Rounded area centers, not a GPS fix or an accuracy guarantee.
        coordinates = [round(longitude, 2), round(latitude, 2)]
    label = ', '.join(dict.fromkeys([city, region or country]))
    return {'label': label, 'coordinates': coordinates, 'source': 'DB-IP City Lite', 'approximate': True}


class AreaLookup:
    def __init__(self, filename):
        self.filename = filename
        self.warned = False

    def __call__(self, ip):
        try:
            if not self.filename or not ipaddress.ip_address(ip).is_global: return None
            import maxminddb
            with maxminddb.open_database(str(self.filename), mode=maxminddb.MODE_FILE) as reader:
                metadata = reader.metadata()
                if metadata.database_type != 'DBIP-City-Lite' or not 0 <= time.time()-metadata.build_epoch <= 100*86400:
                    raise ValueError('City database type or age is not supported')
                area = area_from_record(reader.get(ip))
                if area:
                    area['edition'] = dt.datetime.fromtimestamp(metadata.build_epoch, dt.timezone.utc).strftime('%Y-%m')
                return area
        except Exception as error:
            # Optional enrichment must not break accepted visits or expose the IP.
            if not self.warned:
                logging.getLogger(__name__).warning('Local area lookup unavailable (%s); inspect database installation and age', type(error).__name__)
                self.warned = True
            return None


def illustrate_areas(snapshot):
    """Clearly labeled synthetic geography for the offline design workshop."""
    areas = [('Greenbelt, Maryland',[-76.88,39.00]),('Seattle, Washington',[-122.33,47.61]),
             ('Boulder, Colorado',[-105.27,40.02]),('London, United Kingdom',[-0.13,51.51])]
    for item in snapshot['activity']:
        index = {'resume link':0,'github link':1,'linkedin link':2,'portfolio link':3}.get(item.get('source'),4)
        if item['category']=='home': label,coordinates='Denver, Colorado',[-104.99,39.74]
        elif index==4:
            item['area']=None;item['location']='Location unavailable';continue
        else: label,coordinates=areas[index]
        item['area']={'label':label,'coordinates':coordinates,'source':'Synthetic demo','approximate':True}
        item['location']=label+' (illustration)'
