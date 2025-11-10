#!/usr/bin/env python3

from http.server import HTTPServer, SimpleHTTPRequestHandler

class PensionEvalHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.path = '/index.html'
        return SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    server = HTTPServer(('localhost', 3020), PensionEvalHandler)
    print('Pension Evaluation Dashboard running on http://localhost:3020')
    server.serve_forever()
