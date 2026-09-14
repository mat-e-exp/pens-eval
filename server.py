#!/usr/bin/env python3

from http.server import HTTPServer, SimpleHTTPRequestHandler

class PensionEvalHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Local dev server: never let the browser serve stale JS/CSS/CSV
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        if self.path == '/':
            self.path = '/index.html'
        return SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    server = HTTPServer(('localhost', 3020), PensionEvalHandler)
    print('Pension Evaluation Dashboard running on http://localhost:3020')
    server.serve_forever()
