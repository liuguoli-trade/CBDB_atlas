SELECT COUNT(DISTINCT c_personid) AS total
FROM View_BiogTextData
WHERE c_textid = :entity_id;
