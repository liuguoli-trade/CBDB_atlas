-- Faster count for person search (main fields only; alt names enriched on list rows).
SELECT COUNT(DISTINCT p.c_personid) AS total
FROM View_PeopleData p
WHERE (
  p.c_name_chn LIKE :pattern
  OR p.c_name LIKE :pattern
  OR p.c_surname_chn LIKE :pattern
  OR p.c_mingzi_chn LIKE :pattern
  OR CAST(p.c_personid AS TEXT) = :exact_id
)
AND (:dynasty_code IS NULL OR p.c_dy = :dynasty_code)
AND (:birth_min IS NULL OR p.c_birthyear >= :birth_min)
AND (:birth_max IS NULL OR p.c_birthyear <= :birth_max)
AND (:death_min IS NULL OR p.c_deathyear >= :death_min)
AND (:death_max IS NULL OR p.c_deathyear <= :death_max)
AND (:index_min IS NULL OR p.c_index_year >= :index_min)
AND (:index_max IS NULL OR p.c_index_year <= :index_max)
AND (:female IS NULL OR p.c_female = :female)
AND (:index_addr IS NULL OR p.c_index_addr_chn LIKE :index_addr OR p.c_index_addr_name LIKE :index_addr);
