SELECT *
FROM View_PostingOfficeData
WHERE c_personid = :person_id
ORDER BY c_sequence, c_firstyear
LIMIT :limit OFFSET :offset;
