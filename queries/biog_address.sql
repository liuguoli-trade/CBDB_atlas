SELECT *
FROM View_BiogAddrData
WHERE c_personid = :person_id
ORDER BY c_sequence, c_firstyear
LIMIT :limit OFFSET :offset;
