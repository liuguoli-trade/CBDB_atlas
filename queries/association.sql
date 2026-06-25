SELECT *
FROM View_AssociationData
WHERE c_personid = :person_id
ORDER BY c_assoc_first_year, c_link_chn
LIMIT :limit OFFSET :offset;
