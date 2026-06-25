SELECT *
FROM View_BiogInstAddrData
WHERE c_personid = :person_id
ORDER BY c_bi_begin_year, c_inst_name_hz
LIMIT :limit OFFSET :offset;
