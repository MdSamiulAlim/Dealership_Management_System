import os

bind = f"0.0.0.0:{int(os.environ.get('PORT', '8000'))}"
workers = 1
worker_class = "gthread"
threads = 4
timeout = 120
accesslog = "-"
errorlog = "-"
capture_output = True
# The hosting proxy handles HTTPS. The app does not use forwarded IP headers
# for authorization or trust user-supplied client addresses.
forwarded_allow_ips = ""
