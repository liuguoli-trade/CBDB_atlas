SELECT
  po.*,
  COALESCE(
    NULLIF(
      (
        SELECT GROUP_CONCAT(place, '；')
        FROM (
          SELECT DISTINCT pa.c_office_addr_chn AS place
          FROM View_PostingAddrData AS pa
          WHERE pa.c_posting_id = po.c_posting_id
            AND pa.c_personid = po.c_personid
            AND pa.c_office_id = po.c_office_id
            AND pa.c_addr_id NOT IN (0, -1)
            AND IFNULL(TRIM(pa.c_office_addr_chn), '') NOT IN ('', '[未詳]', '[信息缺乏]')
        )
      ),
      ''
    ),
    (
      SELECT '未詳'
      WHERE EXISTS (
        SELECT 1
        FROM View_PostingAddrData AS pa
        WHERE pa.c_posting_id = po.c_posting_id
          AND pa.c_personid = po.c_personid
          AND pa.c_office_id = po.c_office_id
          AND pa.c_addr_id IN (0, -1)
      )
    )
  ) AS c_posting_places
FROM View_PostingOfficeData AS po
WHERE po.c_personid = :person_id
ORDER BY
  CASE
    WHEN po.c_firstyear IS NOT NULL AND po.c_firstyear NOT IN (-1, 0, -9999) THEN 0
    WHEN po.c_lastyear IS NOT NULL AND po.c_lastyear NOT IN (-1, 0, -9999) THEN 1
    ELSE 2
  END,
  COALESCE(
    CASE WHEN po.c_firstyear IS NOT NULL AND po.c_firstyear NOT IN (-1, 0, -9999) THEN po.c_firstyear END,
    CASE WHEN po.c_lastyear IS NOT NULL AND po.c_lastyear NOT IN (-1, 0, -9999) THEN po.c_lastyear END
  ),
  po.c_sequence
LIMIT :limit OFFSET :offset;
