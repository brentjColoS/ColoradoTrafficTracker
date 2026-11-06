// Synthetic notices matching the shape and boundaries of the reviewed I-25 reports.
function relatedWorkFeatures(anchor = new Date(), corridor = 'I25') {
  const stamp = hours => new Date(anchor.getTime() + hours * 3_600_000).toISOString();
  const offset = corridor === 'I25' ? 0 : 30;
  const direction = corridor === 'I25' ? 'S' : 'W';
  const name = direction === 'S' ? 'Southbound' : 'Westbound';
  return [
    [223.78,223.5,2,9,'center lane','sign repair','Sign Work'],
    [225.35,225,2,9,'center lane','sign repair','Sign Work'],
    [227,223.5,1,82,'left lane and toll lanes','sign repair','Sign Work'],
    [223.43,222.4,170,178,'three left lanes','roadwork','Road work'],
    [226,225.8,2,9,'right lane','bridge repair','Bridge work']
  ].map(([start,end,from,to,lanes,reason,type], index) => ({type:'Feature',id:'related-'+index,
    geometry:{type:'Point',coordinates:corridor === 'I25' ? [-104.98,39.93] : [-105.3,39.71]},
    properties:{incidentProvider:'cdot',corridor,providerEventId:'related-'+index,travelDirection:direction,
      normalizedCategory:'construction',normalizedStatus:'planned',incidentTypeLabel:type,
      active:true,eventActive:true,corridorActive:true,
      sourceStartMarker:start+offset,sourceEndMarker:end+offset,closestMileMarker:(start+end)/2+offset,
      sourceStartedAt:stamp(from),sourceEndedAt:stamp(to),sourceUpdatedAt:stamp(-0.2),
      firstSeenAt:stamp(-2),lastSeenAt:stamp(-0.1),lastMatchedAt:stamp(-0.1),
      incidentNote:`${lanes} closed due to ${reason}.`,incidentImpactLabel:`${name}: ${lanes} closed`,
      incidentDescription:`Between local interchanges from Mile Point ${start+offset} to Mile Point ${end+offset}. ${lanes} closed due to ${reason}.`,
      locationLabel:`${corridor.replace('I','I-')} ${name.toLowerCase()} near MM ${((start+end)/2+offset).toFixed(1)}`}
  }));
}
module.exports = {relatedWorkFeatures};
