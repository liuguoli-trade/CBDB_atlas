SELECT
  c_office_type_node_id,
  c_office_type_desc_chn,
  c_office_type_desc,
  c_parent_id
FROM OFFICE_TYPE_TREE
WHERE (
  (:parent_id IS NULL AND c_parent_id = '0' AND c_office_type_node_id != '0')
  OR (:parent_id IS NOT NULL AND c_parent_id = :parent_id)
)
ORDER BY c_office_type_desc_chn
LIMIT :limit OFFSET :offset;
