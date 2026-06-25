SELECT COUNT(DISTINCT src.c_personid) AS total
FROM (
  SELECT c_personid FROM View_PostingAddrData WHERE c_addr_id = :entity_id
  UNION
  SELECT c_personid FROM View_BiogAddrData WHERE c_addr_id = :entity_id
  UNION
  SELECT c_personid FROM View_PeopleAddrData WHERE c_index_addr_id = :entity_id
  UNION
  SELECT c_personid FROM View_EventAddrData WHERE c_addr_id = :entity_id
  UNION
  SELECT c_personid FROM View_PossessionsAddrData WHERE c_addr_id = :entity_id
) src;
