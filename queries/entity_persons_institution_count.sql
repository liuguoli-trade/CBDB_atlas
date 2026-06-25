SELECT COUNT(DISTINCT c_personid) AS total
FROM View_BiogInstData
WHERE c_inst_name_code = :entity_id;
