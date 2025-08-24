import express from "express";
import cors from "cors";
import authRouter from "./routes/auth.router";
import userRouter from "./routes/user.router";
import estimationRoutes from "./routes/estimation.router";
import HspRoutes from "./routes/hsp.router";
import dashboardRoutes from "./routes/dashboard.router";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/users", userRouter);
app.use("/estimation", estimationRoutes)
app.use("/hsp", HspRoutes)
app.use("/dashboard", dashboardRoutes);
app.get("/ping", (req, res) => {
  res.json({ message: "pong" }).status(200);
});
app.listen(port, () => {
  console.log(`Server up and running on port: ${port}`);
});
