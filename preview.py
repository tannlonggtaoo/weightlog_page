from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


if __name__ == "__main__":
    # Windows can associate .js with plain text, which browsers reject for modules.
    SimpleHTTPRequestHandler.extensions_map[".js"] = "text/javascript"
    handler = partial(SimpleHTTPRequestHandler, directory=Path(__file__).resolve().parent)
    with ThreadingHTTPServer(("127.0.0.1", 8000), handler) as server:
        print("Weightlog: http://127.0.0.1:8000", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
