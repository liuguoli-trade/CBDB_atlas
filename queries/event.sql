SELECT *
FROM View_EventFullData
WHERE c_personid = :person_id
ORDER BY c_year, c_sequence, c_addr_id
LIMIT :limit OFFSET :offset;
