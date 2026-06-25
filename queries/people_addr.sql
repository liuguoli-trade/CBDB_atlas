SELECT *
FROM View_PeopleAddrData
WHERE c_personid = :person_id
ORDER BY c_index_year
LIMIT :limit OFFSET :offset;
