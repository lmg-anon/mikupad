## Running with Docker

You can also run **mikupad** using Docker. This automatically compiles the HTML and runs the custom NodeJS server, which serves the HTML, among other functions.

First, copy `server/.env.example` to `server/.env`. Then, **change your username and password**; anyone who has access to your hosted **mikupad** can store and load sessions, and proxy network requests through your server!

To run the server:

```shell
docker compose -f server/docker-compose.yml up --build -d
```

Then visit http://localhost:3000/.

Note that by default, the server will automatically start when Docker starts (which likely also starts on login). To stop the server, and at the same time also stop it from automatically starting up:

```shell
docker compose -f server/docker-compose.yml down
```

### Adding HTTPS support

You can also add HTTPS support, for example, if you wish to use **mikupad** remotely without revealing your generations or password to the entire world.

First, copy and rename `server/docker-compose.override.example.yml` to `server/docker-compose.override.yml`. Then, uncomment `services:`, as well as the `ADD HTTPS SUPPORT` section. You may also wish to remove unencrypted HTTP support by uncommenting the `REMOVE HTTP SUPPORT` section.

You will also need to provide a SSL certificate. You can do this in any way you wish, such as obtaining one from a [certificate authority](https://letsencrypt.org/) or creating a self-signed one yourself. Regardless, place the public certificate and the private key files in the `https` folder like so:

```shell
$ ls server/https
nginx.conf  private.key  public.crt
```

If you have already started the server, run this command to start up the HTTPS server as well:

```shell
docker compose -f server/docker-compose.yml up -d
```

Then visit https://localhost:3443/.

### Using AI servers running on localhost when running mikupad in Docker

By default, **mikupad** running in server mode will proxy requests to any endpoints. For example, if you are running Ollama (which is OpenAI compatible), you can set the endpoint to `http://localhost:11434` and it'll work.

However, in Docker, you need to replace `localhost` with `host.docker.internal`. For example, the correct endpoint to use for Ollama is `http://host.docker.internal:11434`.

If you are on Linux, you'd need to copy and rename `server/docker-compose.override.example.yml` to `server/docker-compose.override.yml`. Then, uncomment `services:`, as well as the `ADD LOCALHOST AI SERVER SUPPORT FOR LINUX USERS` section.
