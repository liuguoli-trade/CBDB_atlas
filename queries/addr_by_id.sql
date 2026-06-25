SELECT
  c_addr_id,
  c_name_chn,
  c_name,
  c_firstyear,
  c_lastyear,
  c_admin_type,
  x_coord,
  y_coord
FROM ADDR_CODES
WHERE c_addr_id = :addr_id;
