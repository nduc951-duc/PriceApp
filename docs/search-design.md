# Thiết kế search

Parser giữ query gốc, tạo bản không dấu, nhận alias, kích thước và code. PostgreSQL xếp exact (100), prefix (85), structured/FTS, rồi trigram. Không suy diễn đơn vị mơ hồ và không biến đổi `2F5`, `1T5`, `1008`, `A300`.
