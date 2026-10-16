-- rag_chunks stores extensions.vector embeddings. Grant namespace access only;
-- the worker receives no additional table or function privileges here.
grant usage on schema extensions to rag_index_worker;
