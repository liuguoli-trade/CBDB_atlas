SELECT *
FROM View_PossessionsAddrData
WHERE c_personid = :person_id
ORDER BY c_possession_yr, c_sequence
LIMIT :limit OFFSET :offset;
