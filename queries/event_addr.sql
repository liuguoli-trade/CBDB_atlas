SELECT *
FROM View_EventAddrData
WHERE c_personid = :person_id
ORDER BY c_year, c_sequence
LIMIT :limit OFFSET :offset;
