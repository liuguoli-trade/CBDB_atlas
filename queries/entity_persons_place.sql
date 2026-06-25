SELECT DISTINCT
  p.c_personid,
  p.c_name_chn,
  p.c_name,
  p.c_dynasty_chn,
  p.c_birthyear,
  p.c_deathyear,
  src.relation,
  src.detail
FROM View_PeopleData p
JOIN (
  SELECT c_personid, '任官地' AS relation, c_office_addr_chn AS detail
  FROM View_PostingAddrData WHERE c_addr_id = :entity_id
  UNION ALL
  SELECT c_personid, '傳記地址', c_addr_chn FROM View_BiogAddrData WHERE c_addr_id = :entity_id
  UNION ALL
  SELECT c_personid, '索引地址', c_index_addr_chn FROM View_PeopleAddrData WHERE c_index_addr_id = :entity_id
  UNION ALL
  SELECT c_personid, '事件地', c_event_addr_chn FROM View_EventAddrData WHERE c_addr_id = :entity_id
  UNION ALL
  SELECT c_personid, '財產地', c_possession_addr_chn FROM View_PossessionsAddrData WHERE c_addr_id = :entity_id
) src ON src.c_personid = p.c_personid
ORDER BY p.c_name_chn
LIMIT :limit OFFSET :offset;
