FROM docker:27-cli

RUN apk add --no-cache bash curl docker-cli-compose git python3

COPY deploy/webhook/server.py /usr/local/bin/stemegle-webhook
COPY deploy/webhook/deploy.sh /usr/local/bin/stemegle-deploy
RUN chmod +x /usr/local/bin/stemegle-webhook /usr/local/bin/stemegle-deploy

EXPOSE 9000

CMD ["python3", "/usr/local/bin/stemegle-webhook"]
